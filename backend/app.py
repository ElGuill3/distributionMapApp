"""
Punto de entrada de la aplicación distributionMapApp.

Responsabilidades de este módulo:
  - Configurar logging estructurado.
  - Inicializar Google Earth Engine.
  - Crear la instancia Flask y registrar todos los Blueprints.
  - Lanzar el hilo daemon de limpieza de GIFs.
  - Exponer la ruta principal (/) y el servidor de archivos estáticos.
"""

import hashlib
import logging
import os
import sys
from threading import Lock

import ee
from flask import (
    Flask,
    Response,
    jsonify,
    render_template,
    request,
    send_from_directory,
)

from backend import config
from backend.config import (
    BASE_DIR,
    CACHE_POLICIES,
    DEBUG,
    GEE_PROJECT,
    RATE_LIMITS,
    STATIC_DIR,
    TEMPLATES_DIR,
    prepare_runtime_directories,
)
from backend.extensions import limiter
from backend.forecast_feed import PUBLISHED_STATIONS, UNAVAILABLE, UNKNOWN, ForecastFeed
from backend.ipcet_feed import UNAVAILABLE as IPCET_UNAVAILABLE
from backend.ipcet_feed import UNKNOWN as IPCET_UNKNOWN
from backend.ipcet_feed import IpcetFeed, valid_code
from backend.routes.export_routes import export_bp
from backend.routes.flood_routes import flood_bp
from backend.routes.gif_routes import gif_bp
from backend.routes.progress_routes import progress_bp
from backend.routes.station_routes import station_bp
from backend.routes.timeseries_routes import ts_bp
from backend.services.gif_service import start_cleanup_daemon

DEPENDENCY_PREFLIGHT = os.getenv("_DISTRIBUTIONMAPAPP_DEPENDENCY_PREFLIGHT") == "1"

# ---------------------------------------------------------------------------
# Aplicación Flask
# ---------------------------------------------------------------------------
app = Flask(
    __name__,
    static_folder=str(STATIC_DIR),
    template_folder=str(TEMPLATES_DIR),
)

app.config["INITIALIZE_RUNTIME"] = True
_runtime_lock = Lock()
_runtime_initialized = False


def initialize_runtime() -> None:
    """Initialize external runtime once; imports and preflight remain inert."""
    global _runtime_initialized
    if DEPENDENCY_PREFLIGHT:
        return
    with _runtime_lock:
        if _runtime_initialized:
            return
        logging.basicConfig(
            level=logging.DEBUG if DEBUG else logging.INFO,
            format="%(asctime)s - %(name)s - %(levelname)s - %(message)s",
            handlers=[logging.StreamHandler(sys.stderr)],
        )
        prepare_runtime_directories()
        ee.Initialize(project=GEE_PROJECT)
        start_cleanup_daemon()
        _runtime_initialized = True


@app.before_request
def initialize_request_runtime() -> None:
    """Keep WSGI app:app usable without import-time external effects."""
    if app.config["INITIALIZE_RUNTIME"]:
        initialize_runtime()


# ---------------------------------------------------------------------------
# Rate limiting (limiter se inicializa en extensions.py, init_app aquí)
# ---------------------------------------------------------------------------
if not DEPENDENCY_PREFLIGHT:
    limiter.init_app(app)


@app.errorhandler(429)
def rate_limit_exceeded(e):
    """Handler personalizado para respuestas 429 — JSON consistente con Retry-After."""
    try:
        message = f"Rate limit exceeded. Retry after {int(e.description)}s."
    except (TypeError, ValueError):
        message = f"Rate limit exceeded: {e.description}."
    return jsonify({"error": message}), 429


app.register_blueprint(gif_bp)
app.register_blueprint(ts_bp)
app.register_blueprint(flood_bp)
app.register_blueprint(station_bp)
app.register_blueprint(progress_bp)
app.register_blueprint(export_bp)


# ---------------------------------------------------------------------------
# Cabeceras HTTP de caché
# ---------------------------------------------------------------------------


@app.after_request
def inject_cache_headers(response: Response) -> Response:
    """
    Inyecta cabeceras Cache-Control y ETag según la categoría de endpoint.

    - Respuestas de error (4xx/5xx): Cache-Control: no-store
    - Endpoints con max_age=0: Cache-Control: no-store (p. ej. export ZIP)
    - Endpoints configurados en CACHE_POLICIES: Cache-Control: public, max-age=N
    - Si use_etag=True y hay body: ETag basado en MD5 del contenido
    - Rutas no configuradas y SSE: no se añade Cache-Control
    """
    if response.status_code >= 400:
        response.headers["Cache-Control"] = "no-store"
        return response

    for prefix, (max_age, use_etag) in CACHE_POLICIES.items():
        if request.path.startswith(prefix):
            if max_age == 0:
                response.headers["Cache-Control"] = "no-store"
            else:
                response.headers["Cache-Control"] = f"public, max-age={max_age}"
                if use_etag and response.data:
                    etag = hashlib.md5(response.data).hexdigest()
                    response.headers["ETag"] = f'"{etag}"'
            break

    return response


# ---------------------------------------------------------------------------
# Rutas principales
# ---------------------------------------------------------------------------


@app.route("/")
def index():
    # Límites de procesamiento vigentes, solo números, para el cliente
    # (config valida y falla al arranque si algún valor no es finito positivo).
    return render_template(
        "index.html",
        runtime_limits={
            "MAX_SPAN_DEG": config.MAX_SPAN_DEG,
            "MAX_YEARS_RANGE": config.MAX_YEARS_RANGE,
            "MAX_SPAN_DEG_S2": config.MAX_SPAN_DEG_S2,
        },
    )


forecast_feed = ForecastFeed(
    config.BDCTB_FORECAST_URL,
    config.FORECAST_CACHE_PATH,
    token=config.FORECAST_MESSENGER_TOKEN,
)

# Reuse the bounded reader and keep independent validated copies per station.
# Only the BDCTB feed carries the messenger token: one IPCET table serves every
# station, so the other feeds never upload it a second time.
forecast_feeds = {
    code: ForecastFeed(
        "https://raw.githubusercontent.com/ElGuill3/tabasco-river-forecast/"
        f"forecasts/{code.lower()}/latest.json",
        config.FORECAST_CACHE_PATH.parent.parent / code.lower() / "latest.json",
        station_code=code,
    )
    for code in PUBLISHED_STATIONS
    if code != "BDCTB"
}


@app.get("/api/v1/forecasts/<code>")
@limiter.limit(RATE_LIMITS["forecast"])
def station_forecast(code):
    """Reject unpublished codes before any upstream access."""
    if code == "bdctb":
        feed = forecast_feed
    else:
        feed = forecast_feeds.get(code.upper()) if code == code.lower() else None
    if feed is None:
        return jsonify({"error": UNKNOWN}), 404
    result = feed.get()
    if result is None:
        return jsonify({"error": UNAVAILABLE}), 503
    return jsonify(result)


@app.get("/api/v1/forecasts/bdctb")
@limiter.limit(RATE_LIMITS["forecast"])
def bdctb_forecast():
    """Read the published forecast; the optional courier never blocks this route."""
    result = forecast_feed.get()
    if result is None:
        return jsonify({"error": UNAVAILABLE}), 503
    return jsonify(result)


ipcet_levels_feed = IpcetFeed(
    config.IPCET_LEVELS_URL, config.IPCET_LEVELS_CACHE_PATH, kind="levels"
)
ipcet_recent_feed = IpcetFeed(
    config.IPCET_RECENT_URL, config.IPCET_RECENT_CACHE_PATH, kind="recent"
)


@app.get("/api/v1/ipcet/levels")
@limiter.limit(RATE_LIMITS["forecast"])
def ipcet_levels():
    """Return the official table, never a model-derived alert."""
    result = ipcet_levels_feed.get()
    if result is None:
        return jsonify({"error": IPCET_UNAVAILABLE}), 503
    return jsonify(result)


@app.get("/api/v1/ipcet/levels/<code>/recent")
@limiter.limit(RATE_LIMITS["forecast"])
def ipcet_recent(code):
    """Select any published station code without a hard-coded station list."""
    if not valid_code(code):
        return jsonify({"error": IPCET_UNKNOWN}), 404
    result = ipcet_recent_feed.get()
    if result is None:
        return jsonify({"error": IPCET_UNAVAILABLE}), 503
    if code not in result["stations"]:
        return jsonify({"error": IPCET_UNKNOWN}), 404
    return jsonify({**result, "stations": {code: result["stations"][code]}})


@app.route("/static/<path:filename>")
def static_files(filename):
    return send_from_directory(str(STATIC_DIR), filename)


# ---------------------------------------------------------------------------
# API documentation (Scalar UI + raw OpenAPI spec)
# ---------------------------------------------------------------------------


@app.route("/api/docs")
def api_docs():
    """Interactive API documentation UI powered by Scalar."""
    return render_template("scalar.html", spec_url="/api/docs/openapi.yaml")


@app.route("/api/docs/openapi.yaml")
def api_docs_spec():
    """Serve the raw OpenAPI 3.1 specification as YAML."""
    import yaml

    spec_path = BASE_DIR / "backend" / "openapi.yaml"
    with open(spec_path) as f:
        content = yaml.safe_load(f)
    return app.response_class(
        response=yaml.dump(content, allow_unicode=True, sort_keys=False),
        status=200,
        mimetype="application/yaml",
    )


# ---------------------------------------------------------------------------
# Arranque directo
# ---------------------------------------------------------------------------
if os.getenv("_DISTRIBUTIONMAPAPP_RUNTIME_STARTUP") == "1":
    initialize_runtime()

if __name__ == "__main__":
    initialize_runtime()
    app.run(host="0.0.0.0", port=5000, debug=DEBUG)

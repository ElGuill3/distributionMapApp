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
import sys

import ee
from flask import Flask, Request, Response, jsonify, render_template, request, send_from_directory

from config import CACHE_POLICIES, DEBUG, GEE_PROJECT, STATIC_DIR
from extensions import limiter

# ---------------------------------------------------------------------------
# Configuración de logging (una sola vez, antes de importar blueprints)
# ---------------------------------------------------------------------------
logging.basicConfig(
    level=logging.DEBUG if DEBUG else logging.INFO,
    format="%(asctime)s - %(name)s - %(levelname)s - %(message)s",
    handlers=[logging.StreamHandler(sys.stderr)],
)

# ---------------------------------------------------------------------------
# Inicialización de Earth Engine (debe ocurrir antes de importar módulos GEE)
# ---------------------------------------------------------------------------
ee.Initialize(project=GEE_PROJECT)

# ---------------------------------------------------------------------------
# Blueprints
# ---------------------------------------------------------------------------
from routes.gif_routes import gif_bp
from routes.timeseries_routes import ts_bp
from routes.flood_routes import flood_bp
from routes.station_routes import station_bp
from routes.progress_routes import progress_bp
from routes.export_routes import export_bp

# ---------------------------------------------------------------------------
# Limpieza automática de GIFs en segundo plano
# ---------------------------------------------------------------------------
from services.gif_service import start_cleanup_daemon

start_cleanup_daemon()

# ---------------------------------------------------------------------------
# Aplicación Flask
# ---------------------------------------------------------------------------
app = Flask(
    __name__,
    static_folder=str(STATIC_DIR),
    template_folder="templates",
)

# ---------------------------------------------------------------------------
# Rate limiting (limiter se inicializa en extensions.py, init_app aquí)
# ---------------------------------------------------------------------------
limiter.init_app(app)


@app.errorhandler(429)
def rate_limit_exceeded(e):
    """Handler personalizado para respuestas 429 — JSON consistente con Retry-After."""
    return jsonify({
        "error": f"Rate limit exceeded. Retry after {int(e.description)}s.",
    }), 429

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
    return render_template("index.html")


@app.route("/static/<path:filename>")
def static_files(filename):
    return send_from_directory(str(STATIC_DIR), filename)


# ---------------------------------------------------------------------------
# Arranque directo
# ---------------------------------------------------------------------------
if __name__ == "__main__":
    app.run(host="0.0.0.0", port=5000, debug=DEBUG)

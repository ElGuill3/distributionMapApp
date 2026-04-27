"""
Punto de entrada de la aplicación distributionMapApp.

Responsabilidades de este módulo:
  - Configurar logging estructurado.
  - Inicializar Google Earth Engine.
  - Crear la instancia Flask y registrar todos los Blueprints.
  - Lanzar el hilo daemon de limpieza de GIFs.
  - Exponer la ruta principal (/) y el servidor de archivos estáticos.
"""

import logging
import sys

import ee
from flask import Flask, render_template, send_from_directory

from config import DEBUG, GEE_PROJECT, STATIC_DIR

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

app.register_blueprint(gif_bp)
app.register_blueprint(ts_bp)
app.register_blueprint(flood_bp)
app.register_blueprint(station_bp)
app.register_blueprint(progress_bp)


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

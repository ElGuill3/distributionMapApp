"""
Configuración centralizada de la aplicación distributionMapApp.
Todas las constantes, rutas y parámetros de GEE viven aquí.

Variables de entorno (todas con valores por defecto):
  GEE_PROJECT            - Proyecto GEE (default: inundaciones-proyecto)
  FLASK_DEBUG            - Modo debug de Flask (default: false)
  BASE_DIR_OVERRIDE      - Ruta base alternativa para despliegues (opcional)
  GIF_MAX_AGE_MINUTES    - Edad máxima de GIFs antes de limpieza (default: 60)
  GIF_CLEANUP_INTERVAL_S - Intervalo del daemon de limpieza en segundos (default: 600)
"""
from pathlib import Path
import os


def _env_bool(key: str, default: str = "false") -> bool:
    """Lee un booleano de variable de entorno."""
    return os.getenv(key, default).lower() in ("true", "1", "yes")


def _env_int(key: str, default: int) -> int:
    """Lee un entero de variable de entorno con fallback seguro."""
    try:
        return int(os.getenv(key, str(default)))
    except (ValueError, TypeError):
        return default


# ---------------------------------------------------------------------------
# Variables de entorno
# ---------------------------------------------------------------------------
DEBUG = _env_bool("FLASK_DEBUG", "false")
GEE_PROJECT = os.getenv("GEE_PROJECT", "inundaciones-proyecto")

# ---------------------------------------------------------------------------
# Rutas del proyecto
# ---------------------------------------------------------------------------
_base_override = os.getenv("BASE_DIR_OVERRIDE")
BASE_DIR = Path(_base_override) if _base_override else Path(os.path.dirname(os.path.abspath(__file__)))
STATIC_DIR     = BASE_DIR / "static"
GIFS_DIR       = STATIC_DIR / "gifs"
FLOOD_MAPS_DIR = STATIC_DIR / "flood_maps"
DATA_DIR       = BASE_DIR / "data" / "mapa_riesgo" / "municipios"

# Crear directorios necesarios si no existen
GIFS_DIR.mkdir(parents=True, exist_ok=True)
FLOOD_MAPS_DIR.mkdir(parents=True, exist_ok=True)

# ---------------------------------------------------------------------------
# Google Earth Engine
# ---------------------------------------------------------------------------
GEE_PROJECT = "inundaciones-proyecto"

# Colecciones GEE
MODIS_NDVI      = "MODIS/061/MOD13Q1"
ERA5_LAND_DAILY = "ECMWF/ERA5_LAND/DAILY_AGGR"
CHIRPS_DAILY    = "UCSB-CHG/CHIRPS/DAILY"
S2_SR           = "COPERNICUS/S2_SR_HARMONIZED"

# ---------------------------------------------------------------------------
# Límites de procesamiento
# ---------------------------------------------------------------------------
MAX_SPAN_DEG          = 8.0    # Máxima extensión permitida por lado (grados)
MAX_YEARS_RANGE       = 10.0   # Máximo rango de fechas permitido en años (series temporales)
MAX_SPAN_DEG_S2       = 4.0    # Límite más restrictivo para Sentinel-2
MAX_TOTAL_PIXELS      = 26_000_000
BASE_PIXELS_PER_FRAME = 768 * 768
BASE_PIXELS_S2        = 512 * 512  # Base más baja para Sentinel-2 (mayor resolución)
MIN_GIF_DIM           = 256

# ---------------------------------------------------------------------------
# GeoTIFFs de riesgo por municipio
# ---------------------------------------------------------------------------
MUNICIPAL_TIFS = {
    "balancan":         DATA_DIR / "fhi_balancan_100m.tif",
    "cardenas":         DATA_DIR / "fhi_cardenas_100m.tif",
    "centla":           DATA_DIR / "fhi_centla_100m.tif",
    "centro":           DATA_DIR / "fhi_centro_100m.tif",
    "comalcalco":       DATA_DIR / "fhi_comalcalco_100m.tif",
    "cunduacan":        DATA_DIR / "fhi_cunduacan_100m.tif",
    "emiliano_zapata":  DATA_DIR / "fhi_emiliano_zapata_100m.tif",
    "huimanguillo":     DATA_DIR / "fhi_huimanguillo_100m.tif",
    "jalapa":           DATA_DIR / "fhi_jalapa_100m.tif",
    "jalpa_de_mendez":  DATA_DIR / "fhi_jalpa_de_mendez_100m.tif",
    "jonuta":           DATA_DIR / "fhi_jonuta_100m.tif",
    "macuspana":        DATA_DIR / "fhi_macuspana_100m.tif",
    "nacajuca":         DATA_DIR / "fhi_nacajuca_100m.tif",
    "paraiso":          DATA_DIR / "fhi_paraiso_100m.tif",
    "tacotalpa":        DATA_DIR / "fhi_tacotalpa_100m.tif",
    "tenosique":        DATA_DIR / "fhi_tenosique_100m.tif",
}

# ---------------------------------------------------------------------------
# Estaciones hidrometeorológicas locales
# ---------------------------------------------------------------------------
LOCAL_STATIONS = {
    "SPTTB": {
        "name":     "San Pedro (Balancán)",
        "csv_path": BASE_DIR / "SPTTB.csv",
    },
    "BDCTB": {
        "name":     "Boca del Cerro (Tenosique)",
        "csv_path": BASE_DIR / "BDCTB.csv",
    },
}

# ---------------------------------------------------------------------------
# Limpieza automática de GIFs
# ---------------------------------------------------------------------------
GIF_MAX_AGE_MINUTES     = _env_int("GIF_MAX_AGE_MINUTES", 60)
GIF_CLEANUP_INTERVAL_S  = _env_int("GIF_CLEANUP_INTERVAL_S", 600)  # cada 10 minutos

# ---------------------------------------------------------------------------
# Timeouts y parámetros de red
# ---------------------------------------------------------------------------
GIF_DOWNLOAD_TIMEOUT_S   = 120   # Timeout para descarga de GIF desde GEE
SSE_TASK_QUEUE_TIMEOUT_S = 60    # Timeout de la cola SSE en progress endpoint
SSE_WAIT_ATTEMPTS        = 20    # Intentos de espera para que el endpoint GIF registre su cola

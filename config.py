"""
Configuración centralizada de la aplicación distributionMapApp.
Todas las constantes, rutas y parámetros de GEE viven aquí.

Variables de entorno (todas con valores por defecto):
  GEE_PROJECT            - ID del proyecto de Google Cloud
                           (no el nombre visible; p. ej. inundaciones-app-494620)
  FLASK_DEBUG            - Modo debug de Flask (default: false)
  BASE_DIR_OVERRIDE      - Ruta base alternativa para despliegues (opcional)
  GIF_MAX_AGE_MINUTES    - Edad máxima de GIFs antes de limpieza (default: 60)
  GIF_CLEANUP_INTERVAL_S - Intervalo del daemon de limpieza en segundos (default: 600)
  BDCTB_FORECAST_API_BASE_URL - URL base de la API local de pronóstico
"""

import os
from pathlib import Path
from dotenv import load_dotenv

load_dotenv()


def _env_bool(key: str, default: str = "false") -> bool:
    """Lee un booleano de variable de entorno."""
    return os.getenv(key, default).lower() in ("true", "1", "yes")


def _env_int(key: str, default: int) -> int:
    """Lee un entero de variable de entorno con fallback seguro."""
    try:
        return int(os.getenv(key, str(default)))
    except (ValueError, TypeError):
        return default


def _env_float(key: str, default: float) -> float:
    """Lee un flotante de variable de entorno con fallback seguro."""
    try:
        return float(os.getenv(key, str(default)))
    except (ValueError, TypeError):
        return default


def _env_list(key: str, default: str = "") -> list[str]:
    """Lee una lista de strings separada por comas desde variables de entorno."""
    val = os.getenv(key, default).strip()
    if not val:
        return []
    return [s.strip() for s in val.split(",") if s.strip()]


# ---------------------------------------------------------------------------
# Variables de entorno
# ---------------------------------------------------------------------------
DEBUG = _env_bool("FLASK_DEBUG", "false")
GEE_PROJECT = os.getenv("GEE_PROJECT", "inundaciones-proyecto")
CONAGUA_HIDROS_STATIONS = _env_list("CONAGUA_HIDROS_STATIONS", "BDCTB,SPTTB")
CONAGUA_CLIMAS_STATIONS = _env_list("CONAGUA_CLIMAS_STATIONS", "BDCTB,SPTTB")
MINIMAX_API_KEY = os.getenv("MINIMAX_API_KEY", "")
BDCTB_FORECAST_API_BASE_URL = os.getenv(
    "BDCTB_FORECAST_API_BASE_URL", "http://127.0.0.1:8765"
)

# ---------------------------------------------------------------------------
# Rutas del proyecto
# ---------------------------------------------------------------------------
_base_override = os.getenv("BASE_DIR_OVERRIDE")
BASE_DIR = (
    Path(_base_override)
    if _base_override
    else Path(os.path.dirname(os.path.abspath(__file__)))
)
STATIC_DIR = BASE_DIR / "static"
GIFS_DIR = STATIC_DIR / "gifs"
FLOOD_MAPS_DIR = STATIC_DIR / "flood_maps"
DATA_DIR = BASE_DIR / "data" / "mapa_riesgo" / "municipios"

# Crear directorios necesarios si no existen
GIFS_DIR.mkdir(parents=True, exist_ok=True)
FLOOD_MAPS_DIR.mkdir(parents=True, exist_ok=True)

# ---------------------------------------------------------------------------
# Google Earth Engine
# ---------------------------------------------------------------------------
# GEE_PROJECT ya se leyó arriba desde GEE_PROJECT (env). No reasignar aquí:
# sobrescribiría la variable de entorno y confundiría despliegues.

# Colecciones GEE
MODIS_NDVI = os.getenv("GEE_MODIS_NDVI", "MODIS/061/MOD13Q1")
ERA5_LAND_DAILY = os.getenv("GEE_ERA5_LAND_DAILY", "ECMWF/ERA5_LAND/DAILY_AGGR")
CHIRPS_DAILY = os.getenv("GEE_CHIRPS_DAILY", "UCSB-CHG/CHIRPS/DAILY")
S2_SR = os.getenv("GEE_S2_SR", "COPERNICUS/S2_SR_HARMONIZED")

# ---------------------------------------------------------------------------
# Límites de procesamiento
# ---------------------------------------------------------------------------
MAX_SPAN_DEG = _env_float("MAX_SPAN_DEG", 8.0)  # Máxima extensión permitida por lado (grados)
MAX_YEARS_RANGE = _env_float("MAX_YEARS_RANGE", 10.0)  # Máximo rango de fechas permitido en años
MAX_SPAN_DEG_S2 = _env_float("MAX_SPAN_DEG_S2", 4.0)  # Límite restrictivo para Sentinel-2
MAX_TOTAL_PIXELS = _env_int("MAX_TOTAL_PIXELS", 26_000_000)
BASE_PIXELS_PER_FRAME = _env_int("BASE_PIXELS_PER_FRAME", 768 * 768)
BASE_PIXELS_S2 = _env_int("BASE_PIXELS_S2", 512 * 512)  # Base Sentinel-2
MIN_GIF_DIM = _env_int("MIN_GIF_DIM", 256)

# ---------------------------------------------------------------------------
# GeoTIFFs de riesgo por municipio
# ---------------------------------------------------------------------------
MUNICIPAL_TIFS = {
    "balancan": DATA_DIR / "fhi_balancan_100m.tif",
    "cardenas": DATA_DIR / "fhi_cardenas_100m.tif",
    "centla": DATA_DIR / "fhi_centla_100m.tif",
    "centro": DATA_DIR / "fhi_centro_100m.tif",
    "comalcalco": DATA_DIR / "fhi_comalcalco_100m.tif",
    "cunduacan": DATA_DIR / "fhi_cunduacan_100m.tif",
    "emiliano_zapata": DATA_DIR / "fhi_emiliano_zapata_100m.tif",
    "huimanguillo": DATA_DIR / "fhi_huimanguillo_100m.tif",
    "jalapa": DATA_DIR / "fhi_jalapa_100m.tif",
    "jalpa_de_mendez": DATA_DIR / "fhi_jalpa_de_mendez_100m.tif",
    "jonuta": DATA_DIR / "fhi_jonuta_100m.tif",
    "macuspana": DATA_DIR / "fhi_macuspana_100m.tif",
    "nacajuca": DATA_DIR / "fhi_nacajuca_100m.tif",
    "paraiso": DATA_DIR / "fhi_paraiso_100m.tif",
    "tacotalpa": DATA_DIR / "fhi_tacotalpa_100m.tif",
    "tenosique": DATA_DIR / "fhi_tenosique_100m.tif",
}

# ---------------------------------------------------------------------------
# Estaciones hidrometeorológicas locales
# ---------------------------------------------------------------------------
# Coordenadas conocidas de las estaciones locales
STATION_COORDS = {
    "SPTTB": [17.791667, -91.158333],
    "BDCTB": [17.433333, -91.483333],
}

def _load_local_stations() -> dict[str, dict]:
    def clean_encoding(text: str) -> str:
        if not text:
            return text
        try:
            return text.encode("latin-1").decode("utf-8")
        except (UnicodeEncodeError, UnicodeDecodeError):
            return text

    stations = {}
    stations_dir = BASE_DIR / "data" / "stations"
    if not stations_dir.exists():
        return stations

    # Escaneo recursivo buscando archivos en subcarpetas 'hidros' y 'climas'
    for csv_file in stations_dir.glob("**/*.csv"):
        try:
            parent_name = csv_file.parent.name.lower()
            if parent_name == "hidros":
                station_type = "hidrometrica"
                type_suffix = "hidro"
                metric_label = "[Nivel]"
            elif parent_name == "climas":
                station_type = "climatolica"
                type_suffix = "clima"
                metric_label = "[Precipitación]"
            elif parent_name == "stations":
                station_type = "hidrometrica"
                type_suffix = "hidro"
                metric_label = "[Nivel]"
            else:
                continue

            # Intentar leer con UTF-8
            with open(csv_file, "r", encoding="utf-8") as f:
                lines = [f.readline().strip() for _ in range(6)]
            
            metadata = {}
            for line in lines:
                if ":" in line:
                    parts = line.split(":", 1)
                    metadata[parts[0].strip()] = parts[1].strip()
            
            station_key = None
            station_name = None
            municipio = None
            for k, v in metadata.items():
                k_lower = k.lower()
                if "clave" in k_lower:
                    station_key = clean_encoding(v)
                elif "estac" in k_lower:
                    station_name = clean_encoding(v)
                elif "municip" in k_lower:
                    municipio = clean_encoding(v)
            
            if station_key and station_name:
                display_name = f"{station_name} ({municipio}) {metric_label}" if municipio else f"{station_name} {metric_label}"
                combined_key = f"{station_key}_{type_suffix}"
                stations[combined_key] = {
                    "name": display_name,
                    "station_name": station_name,
                    "municipio": municipio,
                    "csv_path": csv_file,
                    "type": station_type,
                    "coords": STATION_COORDS.get(station_key.upper()),
                }
        except Exception:
            # Fallback a Latin-1 por si falla la decodificación por caracteres con tilde
            try:
                with open(csv_file, "r", encoding="latin-1") as f:
                    lines = [f.readline().strip() for _ in range(6)]
                
                metadata = {}
                for line in lines:
                    if ":" in line:
                        parts = line.split(":", 1)
                        metadata[parts[0].strip()] = parts[1].strip()
                
                station_key = None
                station_name = None
                municipio = None
                for k, v in metadata.items():
                    k_lower = k.lower()
                    if "clave" in k_lower:
                        station_key = clean_encoding(v)
                    elif "estac" in k_lower:
                        station_name = clean_encoding(v)
                    elif "municip" in k_lower:
                        municipio = clean_encoding(v)
                
                if station_key and station_name:
                    display_name = f"{station_name} ({municipio}) {metric_label}" if municipio else f"{station_name} {metric_label}"
                    combined_key = f"{station_key}_{type_suffix}"
                    stations[combined_key] = {
                        "name": display_name,
                        "station_name": station_name,
                        "municipio": municipio,
                        "csv_path": csv_file,
                        "type": station_type,
                        "coords": STATION_COORDS.get(station_key.upper()),
                    }
            except Exception:
                pass
    return stations


LOCAL_STATIONS = _load_local_stations()

# ---------------------------------------------------------------------------
# Limpieza automática de GIFs
# ---------------------------------------------------------------------------
GIF_MAX_AGE_MINUTES = _env_int("GIF_MAX_AGE_MINUTES", 60)
GIF_CLEANUP_INTERVAL_S = _env_int("GIF_CLEANUP_INTERVAL_S", 600)  # cada 10 minutos

# ---------------------------------------------------------------------------
# Cabeceras HTTP de caché
# ---------------------------------------------------------------------------
# Route prefix → (max_age_seconds, use_etag)
# Los endpoints de GIF tienen cache largo (1h) porque el archivo es inmutable
# una vez generado; timeseries son datos diarios (5 min); flood risk es estático
# (24h); estaciones locales tienen datos que cambian poco (10 min).
CACHE_POLICIES = {
    "/api/ndvi-gif": (3600, True),  # GIF JSON — 1 hora
    "/api/era5-temp-gif": (3600, True),
    "/api/era5-soil-gif": (3600, True),
    "/api/imerg-precip-gif": (3600, True),
    "/api/water-gif": (3600, True),
    "/api/ndvi-timeseries": (300, True),  # Timeseries JSON — 5 min
    "/api/era5-temp-timeseries": (300, True),
    "/api/era5-soil-timeseries": (300, True),
    "/api/imerg-precip-timeseries": (300, True),
    "/api/water-timeseries": (300, True),
    "/api/flood-risk": (86400, False),  # Mapa riesgo — 24h, sin ETag
    "/api/local-station": (600, True),  # Estaciones — 10 min
    "/api/v1/forecasts/bdctb": (0, False),  # Pronóstico — no cachear
    "/api/export": (0, False),  # Export ZIP — no cachear
}

# ---------------------------------------------------------------------------
# Rate limiting
# ---------------------------------------------------------------------------
RATE_LIMIT_ENABLED = _env_bool("RATE_LIMIT_ENABLED", "true")

# Límites por categoría de endpoint (request por minuto por IP)
RATE_LIMITS = {
    "gif": os.getenv("RATE_LIMIT_GIF", "30/minute"),  # Endpoints *-gif-bbox (costosos: llaman GEE)
    "timeseries": os.getenv("RATE_LIMIT_TIMESERIES", "60/minute"),  # Endpoints *-timeseries-bbox
    "export": os.getenv("RATE_LIMIT_EXPORT", "10/minute"),  # Endpoint /api/export/bundle (POST, genera ZIP)
    "flood": os.getenv("RATE_LIMIT_FLOOD", "60/minute"),  # Endpoint /api/flood-risk-municipio
    "station": os.getenv("RATE_LIMIT_STATION", "60/minute"),  # Endpoint /api/local-station-level-range
}

# ---------------------------------------------------------------------------
# Timeouts y parámetros de red
# ---------------------------------------------------------------------------
GIF_DOWNLOAD_TIMEOUT_S = _env_int("GIF_DOWNLOAD_TIMEOUT_S", 120)  # Timeout para descarga de GIF desde GEE
SSE_TASK_QUEUE_TIMEOUT_S = _env_int("SSE_TASK_QUEUE_TIMEOUT_S", 60)  # Timeout de la cola SSE en progress endpoint
SSE_WAIT_ATTEMPTS = _env_int("SSE_WAIT_ATTEMPTS", 100)  # Intentos de espera para que el endpoint GIF registre su cola

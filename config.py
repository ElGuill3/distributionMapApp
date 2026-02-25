"""
Configuración centralizada de la aplicación distributionMapApp.
Todas las constantes, rutas y parámetros de GEE viven aquí.
"""
from pathlib import Path
import os

# ---------------------------------------------------------------------------
# Rutas del proyecto
# ---------------------------------------------------------------------------
BASE_DIR       = Path(os.path.dirname(os.path.abspath(__file__)))
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
GIF_MAX_AGE_MINUTES     = 60
GIF_CLEANUP_INTERVAL_S  = 600  # cada 10 minutos

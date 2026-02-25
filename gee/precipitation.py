"""
Módulo GEE para Precipitación diaria (CHIRPS).

Colección : UCSB-CHG/CHIRPS/DAILY
Banda     : precipitation (mm/día, sin conversión)
Período   : diario
"""
from typing import Optional

import ee

from config import CHIRPS_DAILY, BASE_PIXELS_PER_FRAME
from gee.utils import validate_bbox, compute_gif_dims, build_base_collection

_BAND              = 'precipitation'
_FRAMES_PER_SECOND = 5
_REDUCE_SCALE      = 5_000  # metros — resolución nativa CHIRPS ≈ 5.5 km

_VIS_PARAMS: dict = {
    'min': 0.0,
    'max': 80.0,
    'palette': ['ffffff', 'cce7ff', '99ccff', '66b2ff', '3389ff', '0055ff', '002b7f'],
}


def build_chirps_precip_gif_bbox(
    start: str,
    end: str,
    bbox: list[float],
    ratio: Optional[float] = None,
) -> Optional[str]:
    """
    Genera la URL de un GIF animado de precipitación diaria (CHIRPS).

    No se aplica transformación de unidades; la banda ya está en mm/día.

    Args:
        start : Fecha de inicio 'YYYY-MM-DD'.
        end   : Fecha de fin 'YYYY-MM-DD'.
        bbox  : [minLon, minLat, maxLon, maxLat].
        ratio : Relación ancho/alto del GIF.

    Returns:
        URL del GIF en GEE, o None si no hay datos.
    """
    validate_bbox(bbox)

    region    = ee.Geometry.Rectangle(bbox)
    col       = build_base_collection(CHIRPS_DAILY, _BAND, bbox, start, end)
    n_frames  = int(col.size().getInfo())

    if n_frames == 0:
        return None

    dims = compute_gif_dims(n_frames, ratio, BASE_PIXELS_PER_FRAME)

    return col.getVideoThumbURL({
        'region':          region,
        'dimensions':      dims,
        'framesPerSecond': _FRAMES_PER_SECOND,
        'format':          'gif',
        'bands':           [_BAND],
        'crs':             'EPSG:3857',
        **_VIS_PARAMS,
    })


def build_chirps_precip_timeseries_bbox(
    start: str,
    end: str,
    bbox: list[float],
) -> tuple[list[str], list[float]]:
    """
    Calcula la precipitación media diaria (mm) en el bbox.

    Args:
        start : Fecha de inicio 'YYYY-MM-DD'.
        end   : Fecha de fin 'YYYY-MM-DD'.
        bbox  : [minLon, minLat, maxLon, maxLat].

    Returns:
        Tupla (fechas, precipitacion_mm). Ambas listas vacías si no hay datos.
    """
    validate_bbox(bbox)

    region = ee.Geometry.Rectangle(bbox)
    col    = build_base_collection(CHIRPS_DAILY, _BAND, bbox, start, end)

    if col.size().eq(0).getInfo():
        return [], []

    def _daily_mean_feature(img: ee.Image) -> ee.Feature:
        mean_val = ee.Number(
            img.reduceRegion(
                reducer=ee.Reducer.mean(),
                geometry=region,
                scale=_REDUCE_SCALE,
                maxPixels=1e7,
            ).get(_BAND)
        ).max(0)
        date_str = ee.Date(img.get('system:time_start')).format('YYYY-MM-dd')
        return ee.Feature(None, {'date': date_str, 'precip_mm': mean_val})

    fc    = col.map(_daily_mean_feature)
    dates = fc.aggregate_array('date').getInfo()
    vals  = fc.aggregate_array('precip_mm').getInfo()

    out_dates: list[str]   = []
    out_vals:  list[float] = []
    for d, v in zip(dates, vals):
        if d is not None and v is not None:
            out_dates.append(d)
            out_vals.append(float(v))

    return out_dates, out_vals

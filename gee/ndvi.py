"""
Módulo GEE para NDVI (MODIS MOD13Q1).

Colección : MODIS/061/MOD13Q1
Banda     : NDVI (escala × 0.0001 → rango –0.1 a 1.0)
Período   : cada 16 días
"""
from typing import Optional

import ee

from config import MODIS_NDVI, BASE_PIXELS_PER_FRAME
from gee.utils import validate_bbox, compute_gif_dims, build_base_collection


# Parámetros de visualización para el GIF
_VIS_PARAMS: dict = {
    'min': 0.0,
    'max': 0.8,
    'palette': ['A50026', 'D73027', 'FFFFBF', 'A6D96A', '006837'],
}

_FRAMES_PER_SECOND = 2
_REDUCE_SCALE      = 1_000  # metros — resolución nativa MODIS ≈ 250 m


def build_ndvi_gif_bbox(
    start: str,
    end: str,
    bbox: list[float],
    ratio: Optional[float] = None,
) -> Optional[str]:
    """
    Genera la URL de un GIF animado de NDVI para el bounding box indicado.

    La colección MODIS MOD13Q1 tiene composiciones de 16 días.
    Cada imagen es escalada (× 0.0001) y enmascarada fuera del rango válido.

    Args:
        start : Fecha de inicio 'YYYY-MM-DD'.
        end   : Fecha de fin 'YYYY-MM-DD'.
        bbox  : [minLon, minLat, maxLon, maxLat].
        ratio : Relación ancho/alto del GIF. Si es None se usa imagen cuadrada.

    Returns:
        URL del GIF en GEE, o None si no hay imágenes para ese período/región.
    """
    validate_bbox(bbox)

    region = ee.Geometry.Rectangle(bbox)
    col    = build_base_collection(MODIS_NDVI, 'NDVI', bbox, start, end)

    n_frames = int(col.size().getInfo())
    if n_frames == 0:
        return None

    def _scale_and_mask(img: ee.Image) -> ee.Image:
        ndvi = img.multiply(0.0001)
        mask = ndvi.gte(-0.1).And(ndvi.lte(1.0))
        return ndvi.updateMask(mask).copyProperties(img, ['system:time_start'])

    col_scaled = col.map(_scale_and_mask)
    dims       = compute_gif_dims(n_frames, ratio, BASE_PIXELS_PER_FRAME)

    return col_scaled.getVideoThumbURL({
        'region':         region,
        'dimensions':     dims,
        'framesPerSecond': _FRAMES_PER_SECOND,
        'format':         'gif',
        'bands':          ['NDVI'],
        'crs':            'EPSG:3857',
        **_VIS_PARAMS,
    })


def build_ndvi_timeseries_bbox(
    start: str,
    end: str,
    bbox: list[float],
) -> tuple[list[str], list[float]]:
    """
    Calcula la media espacial de NDVI para cada imagen dentro del bbox.

    Args:
        start : Fecha de inicio 'YYYY-MM-DD'.
        end   : Fecha de fin 'YYYY-MM-DD'.
        bbox  : [minLon, minLat, maxLon, maxLat].

    Returns:
        Tupla (fechas, valores_ndvi). Ambas listas vacías si no hay datos.
    """
    validate_bbox(bbox)

    region = ee.Geometry.Rectangle(bbox)
    col    = build_base_collection(MODIS_NDVI, 'NDVI', bbox, start, end)

    if col.size().eq(0).getInfo():
        return [], []

    def _mean_feature(img: ee.Image) -> ee.Feature:
        ndvi     = img.multiply(0.0001)
        mask     = ndvi.gte(-0.1).And(ndvi.lte(1.0))
        ndvi     = ndvi.updateMask(mask)
        mean_val = ee.Number(
            ndvi.reduceRegion(
                reducer=ee.Reducer.mean(),
                geometry=region,
                scale=_REDUCE_SCALE,
                maxPixels=1e7,
            ).get('NDVI')
        ).max(-0.1).min(1.0)
        date_str = ee.Date(img.get('system:time_start')).format('YYYY-MM-dd')
        return ee.Feature(None, {'date': date_str, 'ndvi': mean_val})

    fc    = col.map(_mean_feature)
    dates = fc.aggregate_array('date').getInfo()
    vals  = fc.aggregate_array('ndvi').getInfo()

    out_dates: list[str]   = []
    out_vals:  list[float] = []
    for d, v in zip(dates, vals):
        if d is not None and v is not None:
            out_dates.append(d)
            out_vals.append(float(v))

    return out_dates, out_vals

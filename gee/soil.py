"""
Módulo GEE para Humedad Volumétrica del Suelo (ERA5-Land, capa 1).

Colección : ECMWF/ERA5_LAND/DAILY_AGGR
Banda     : volumetric_soil_water_layer_1 (m³/m³ × 100 → %)
Período   : diario
"""
from typing import Optional

import ee

from config import ERA5_LAND_DAILY, BASE_PIXELS_PER_FRAME
from gee.utils import validate_bbox, compute_gif_dims, build_base_collection

_BAND              = 'volumetric_soil_water_layer_1'
_FRAMES_PER_SECOND = 3
_REDUCE_SCALE      = 10_000  # metros — resolución nativa ERA5 ≈ 9 km

_VIS_PARAMS: dict = {
    'min': 0.0,
    'max': 60.0,
    'palette': [
        '552200', '8c510a', 'bf812d', 'dfc27d',
        'f6e8c3', 'c7eae5', '80cdc1', '35978f', '01665e',
    ],
}


def build_era5_soil_gif_bbox(
    start: str,
    end: str,
    bbox: list[float],
    ratio: Optional[float] = None,
) -> Optional[str]:
    """
    Genera la URL de un GIF animado de humedad del suelo (ERA5-Land, 0–7 cm).

    La banda volumetric_soil_water_layer_1 está en m³/m³; se multiplica por 100
    para expresarla como porcentaje y se enmascara fuera del rango 0–100 %.

    Args:
        start : Fecha de inicio 'YYYY-MM-DD'.
        end   : Fecha de fin 'YYYY-MM-DD'.
        bbox  : [minLon, minLat, maxLon, maxLat].
        ratio : Relación ancho/alto del GIF.

    Returns:
        URL del GIF en GEE, o None si no hay datos.
    """
    validate_bbox(bbox)

    region = ee.Geometry.Rectangle(bbox)
    col    = build_base_collection(ERA5_LAND_DAILY, _BAND, bbox, start, end)

    n_frames = int(col.size().getInfo())
    if n_frames == 0:
        return None

    def _to_percent_and_mask(img: ee.Image) -> ee.Image:
        sm_pct = img.multiply(100)
        mask   = sm_pct.gte(0).And(sm_pct.lte(100))
        return sm_pct.updateMask(mask).copyProperties(img, ['system:time_start'])

    col_p = col.map(_to_percent_and_mask)
    dims  = compute_gif_dims(n_frames, ratio, BASE_PIXELS_PER_FRAME)

    return col_p.getVideoThumbURL({
        'region':          region,
        'dimensions':      dims,
        'framesPerSecond': _FRAMES_PER_SECOND,
        'format':          'gif',
        'bands':           [_BAND],
        'crs':             'EPSG:3857',
        **_VIS_PARAMS,
    })


def build_era5_soil_timeseries_bbox(
    start: str,
    end: str,
    bbox: list[float],
) -> tuple[list[str], list[float]]:
    """
    Calcula la humedad media diaria del suelo (%) en el bbox.

    Args:
        start : Fecha de inicio 'YYYY-MM-DD'.
        end   : Fecha de fin 'YYYY-MM-DD'.
        bbox  : [minLon, minLat, maxLon, maxLat].

    Returns:
        Tupla (fechas, valores_porcentaje). Ambas listas vacías si no hay datos.
    """
    validate_bbox(bbox)

    region = ee.Geometry.Rectangle(bbox)
    col    = build_base_collection(ERA5_LAND_DAILY, _BAND, bbox, start, end)

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
        ).max(0).min(1).multiply(100)
        date_str = ee.Date(img.get('system:time_start')).format('YYYY-MM-dd')
        return ee.Feature(None, {'date': date_str, 'soil_pct': mean_val})

    fc    = col.map(_daily_mean_feature)
    dates = fc.aggregate_array('date').getInfo()
    vals  = fc.aggregate_array('soil_pct').getInfo()

    out_dates: list[str]   = []
    out_vals:  list[float] = []
    for d, v in zip(dates, vals):
        if d is not None and v is not None:
            out_dates.append(d)
            out_vals.append(float(v))

    return out_dates, out_vals

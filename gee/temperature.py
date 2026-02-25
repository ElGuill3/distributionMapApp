"""
Módulo GEE para Temperatura del Aire a 2 m (ERA5-Land).

Colección : ECMWF/ERA5_LAND/DAILY_AGGR
Banda     : temperature_2m (Kelvin → Celsius restando 273.15)
Período   : diario
"""
from typing import Optional

import ee

from config import ERA5_LAND_DAILY, BASE_PIXELS_PER_FRAME
from gee.utils import validate_bbox, compute_gif_dims, build_base_collection

_BAND              = 'temperature_2m'
_FRAMES_PER_SECOND = 3
_REDUCE_SCALE      = 10_000  # metros — resolución nativa ERA5 ≈ 9 km

_VIS_PARAMS: dict = {
    'min': 0.0,
    'max': 35.0,
    'palette': [
        '000080', '0000d9', '4000ff', '0080ff', '00ffff',
        '00ff80', '80ff00', 'daff00', 'ffff00',
        'ffb000', 'ff4f00', 'ff0000',
    ],
}


def build_era5_temp_gif_bbox(
    start: str,
    end: str,
    bbox: list[float],
    ratio: Optional[float] = None,
) -> Optional[str]:
    """
    Genera la URL de un GIF animado de temperatura del aire (ERA5-Land).

    La banda temperature_2m está en Kelvin; se convierte a Celsius y se
    enmascara fuera del rango –20 °C a 50 °C.

    Args:
        start : Fecha de inicio 'YYYY-MM-DD'.
        end   : Fecha de fin 'YYYY-MM-DD'.
        bbox  : [minLon, minLat, maxLon, maxLat].
        ratio : Relación ancho/alto del GIF. Si es None se usa imagen cuadrada.

    Returns:
        URL del GIF en GEE, o None si no hay datos para ese período/región.
    """
    validate_bbox(bbox)

    region = ee.Geometry.Rectangle(bbox)
    col    = build_base_collection(ERA5_LAND_DAILY, _BAND, bbox, start, end)

    n_frames = int(col.size().getInfo())
    if n_frames == 0:
        return None

    def _to_celsius_and_mask(img: ee.Image) -> ee.Image:
        temp_c = img.subtract(273.15)
        mask   = temp_c.gte(-20).And(temp_c.lte(50))
        return temp_c.updateMask(mask).copyProperties(img, ['system:time_start'])

    col_c = col.map(_to_celsius_and_mask)
    dims  = compute_gif_dims(n_frames, ratio, BASE_PIXELS_PER_FRAME)

    return col_c.getVideoThumbURL({
        'region':          region,
        'dimensions':      dims,
        'framesPerSecond': _FRAMES_PER_SECOND,
        'format':          'gif',
        'bands':           [_BAND],
        'crs':             'EPSG:3857',
        **_VIS_PARAMS,
    })


def build_era5_temp_timeseries_bbox(
    start: str,
    end: str,
    bbox: list[float],
) -> tuple[list[str], list[float]]:
    """
    Calcula la temperatura media diaria (°C) en el bbox.

    Args:
        start : Fecha de inicio 'YYYY-MM-DD'.
        end   : Fecha de fin 'YYYY-MM-DD'.
        bbox  : [minLon, minLat, maxLon, maxLat].

    Returns:
        Tupla (fechas, temperaturas_celsius). Ambas listas vacías si no hay datos.
    """
    validate_bbox(bbox)

    region = ee.Geometry.Rectangle(bbox)
    col    = build_base_collection(ERA5_LAND_DAILY, _BAND, bbox, start, end)

    if col.size().eq(0).getInfo():
        return [], []

    def _daily_mean_feature(img: ee.Image) -> ee.Feature:
        temp_c   = img.subtract(273.15)
        mask     = temp_c.gte(-20).And(temp_c.lte(50))
        temp_c   = temp_c.updateMask(mask)
        mean_val = ee.Number(
            temp_c.reduceRegion(
                reducer=ee.Reducer.mean(),
                geometry=region,
                scale=_REDUCE_SCALE,
                maxPixels=1e7,
            ).get(_BAND)
        ).max(-20).min(50)
        date_str = ee.Date(img.get('system:time_start')).format('YYYY-MM-dd')
        return ee.Feature(None, {'date': date_str, 'temp_c': mean_val})

    fc    = col.map(_daily_mean_feature)
    dates = fc.aggregate_array('date').getInfo()
    vals  = fc.aggregate_array('temp_c').getInfo()

    out_dates: list[str]   = []
    out_vals:  list[float] = []
    for d, v in zip(dates, vals):
        if d is not None and v is not None:
            out_dates.append(d)
            out_vals.append(float(v))

    return out_dates, out_vals

"""
Módulo GEE para Cuerpos de Agua (Sentinel-2 SR).

Colección : COPERNICUS/S2_SR_HARMONIZED
Bandas    : B3 (verde), B8 (NIR), QA60 (máscara de nubes)
Índice    : NDWI = (B3 – B8) / (B3 + B8), umbral > 0.15
Período   : variable (revisita ~5 días)

Nota: el límite espacial para Sentinel-2 es MAX_SPAN_DEG_S2 = 4° (resolución
10 m hace inviable áreas muy grandes).
"""
from typing import Optional

import ee

from config import S2_SR, BASE_PIXELS_S2, MAX_SPAN_DEG_S2
from gee.utils import validate_bbox, compute_gif_dims

_FRAMES_PER_SECOND = 2
_CLOUD_FILTER      = 60   # máximo % nubosidad permitido
_NDWI_THRESHOLD    = 0.15
_NDWI_TS_THRESHOLD = 0.20
_MIN_CONNECTED_PX  = 9    # para eliminar agua espúrea en GIF
_REDUCE_SCALE_GIF  = 60   # metros — Sentinel-2 Nivel-2A nativa 10 m (60 m es suficiente para area)
_REDUCE_SCALE_TS   = 60

_VIS_PARAMS: dict = {
    'min':     0,
    'max':     1,
    'palette': ['00000000', '0000ff'],
}


def _apply_cloud_mask(img: ee.Image) -> ee.Image:
    """Aplica la máscara de nubes de la banda QA60 de Sentinel-2."""
    qa          = img.select('QA60')
    cloud_bit   = 1 << 10
    cirrus_bit  = 1 << 11
    cloud_mask  = (
        qa.bitwiseAnd(cloud_bit).eq(0)
        .And(qa.bitwiseAnd(cirrus_bit).eq(0))
    )
    return img.updateMask(cloud_mask)


def _get_s2_collection(bbox: list[float], start: str, end: str) -> ee.ImageCollection:
    """Filtra la colección S2-SR por fecha, región, nubosidad y bandas necesarias."""
    region = ee.Geometry.Rectangle(bbox)
    return (
        ee.ImageCollection(S2_SR)
        .filterDate(ee.Date(start), ee.Date(end))
        .filterBounds(region)
        .filter(ee.Filter.lte('CLOUDY_PIXEL_PERCENTAGE', _CLOUD_FILTER))
        .select(['B3', 'B8', 'QA60'])
        .map(_apply_cloud_mask)
    )


def build_water_gif_bbox(
    start: str,
    end: str,
    bbox: list[float],
    ratio: Optional[float] = None,
) -> Optional[str]:
    """
    Genera la URL de un GIF animado de detección de agua superficial (Sentinel-2).

    Algoritmo:
    1. Calcula NDWI = (B3 – B8) / (B3 + B8).
    2. Clasifica como agua los píxeles con NDWI > 0.15.
    3. Aplica moda focal (radio 1 píxel) para suavizar.
    4. Filtra por conectividad mínima (≥ 9 píxeles) para eliminar ruido.

    El límite espacial es MAX_SPAN_DEG_S2 (4°) en lugar de los 8° habituales,
    ya que la resolución de 10 m haría inviable áreas más grandes.

    Args:
        start : Fecha de inicio 'YYYY-MM-DD'.
        end   : Fecha de fin 'YYYY-MM-DD'.
        bbox  : [minLon, minLat, maxLon, maxLat].
        ratio : Relación ancho/alto del GIF.

    Returns:
        URL del GIF en GEE, o None si no hay imágenes.
    """
    validate_bbox(bbox, max_span=MAX_SPAN_DEG_S2)

    region = ee.Geometry.Rectangle(bbox)
    col    = _get_s2_collection(bbox, start, end)

    def _ndwi_water(img: ee.Image) -> ee.Image:
        green = img.select('B3').multiply(0.0001)
        nir   = img.select('B8').multiply(0.0001)
        ndwi  = green.subtract(nir).divide(green.add(nir)).rename('NDWI')

        water     = ndwi.gt(_NDWI_THRESHOLD)
        water     = water.focal_mode(radius=1, units='pixels')
        water     = water.selfMask()
        connected = water.connectedPixelCount(maxSize=100, eightConnected=True)
        water     = water.updateMask(connected.gte(_MIN_CONNECTED_PX)).rename('water')

        return water.copyProperties(img, ['system:time_start'])

    col_water = col.map(_ndwi_water)
    n_frames  = int(col_water.size().getInfo())

    if n_frames == 0:
        return None

    dims = compute_gif_dims(n_frames, ratio, BASE_PIXELS_S2)

    return col_water.getVideoThumbURL({
        'region':          region,
        'dimensions':      dims,
        'framesPerSecond': _FRAMES_PER_SECOND,
        'format':          'gif',
        'bands':           ['water'],
        'crs':             'EPSG:3857',
        **_VIS_PARAMS,
    })


def build_water_timeseries_bbox(
    start: str,
    end: str,
    bbox: list[float],
) -> tuple[list[str], list[float]]:
    """
    Estima el área de agua superficial (ha) por imagen en el bbox.

    Calcula el área de agua como la suma de píxeles con NDWI > 0.20 multiplicada
    por el área de cada píxel (ee.Image.pixelArea).

    Args:
        start : Fecha de inicio 'YYYY-MM-DD'.
        end   : Fecha de fin 'YYYY-MM-DD'.
        bbox  : [minLon, minLat, maxLon, maxLat].

    Returns:
        Tupla (fechas, area_ha). Ambas listas vacías si no hay datos.
    """
    validate_bbox(bbox, max_span=MAX_SPAN_DEG_S2)

    region = ee.Geometry.Rectangle(bbox)
    col    = _get_s2_collection(bbox, start, end)

    if col.size().eq(0).getInfo():
        return [], []

    def _water_fraction(img: ee.Image) -> ee.Feature:
        green = img.select('B3').multiply(0.0001)
        nir   = img.select('B8').multiply(0.0001)
        ndwi  = green.subtract(nir).divide(green.add(nir)).rename('NDWI')
        water = ndwi.gt(_NDWI_TS_THRESHOLD).rename('water')

        area_img = ee.Image.pixelArea().multiply(water.unmask(0)).rename('area')
        stats    = area_img.reduceRegion(
            reducer=ee.Reducer.sum(),
            geometry=region,
            scale=_REDUCE_SCALE_TS,
            maxPixels=5e7,
            bestEffort=True,
        )
        area_ha  = ee.Number(stats.get('area')).divide(10_000)
        date_str = ee.Date(img.get('system:time_start')).format('YYYY-MM-dd')
        return ee.Feature(None, {'date': date_str, 'water_ha': area_ha})

    fc    = col.map(_water_fraction)
    dates = fc.aggregate_array('date').getInfo()
    vals  = fc.aggregate_array('water_ha').getInfo()

    out_dates: list[str]   = []
    out_vals:  list[float] = []
    for d, v in zip(dates, vals):
        if d is not None and v is not None:
            out_dates.append(d)
            out_vals.append(float(v))

    return out_dates, out_vals

"""
Utilidades compartidas para todas las operaciones con Google Earth Engine.

Este módulo provee las funciones que se repetían en cada variable:
  - validate_bbox      : valida que el área no supere el límite configurado
  - compute_gif_dims   : calcula dimensiones WxH respetando el presupuesto de píxeles
  - build_base_collection: filtra una colección GEE por fecha, región y banda
  - season_to_dates    : convierte año + temporada a rango YYYY-MM-DD
"""
import calendar
import math
from typing import Optional
from datetime import datetime

import ee

from config import (
    MAX_SPAN_DEG,
    MAX_TOTAL_PIXELS,
    MAX_YEARS_RANGE,
    BASE_PIXELS_PER_FRAME,
    MIN_GIF_DIM,
)


def validate_bbox(bbox: list[float], max_span: float = MAX_SPAN_DEG) -> None:
    """
    Lanza ValueError si alguna dimensión del bbox supera max_span grados.

    Args:
        bbox: [minLon, minLat, maxLon, maxLat]
        max_span: extensión máxima permitida (grados). Por defecto MAX_SPAN_DEG.
    """
    min_lon, min_lat, max_lon, max_lat = bbox
    if (max_lon - min_lon) > max_span or (max_lat - min_lat) > max_span:
        raise ValueError(
            f"El bounding box es demasiado grande (máx. {max_span}°). "
            "Reduce el área seleccionada."
        )


def compute_gif_dims(
    n_frames: int,
    ratio: Optional[float] = None,
    base_pixels: int = BASE_PIXELS_PER_FRAME,
) -> str:
    """
    Calcula dimensiones 'WxH' para getVideoThumbURL respetando el límite total de píxeles.

    Args:
        n_frames: número de frames del GIF.
        ratio: relación ancho/alto (width/height). Si es None se usa imagen cuadrada.
        base_pixels: píxeles máximos por frame antes de escalar por n_frames.

    Returns:
        String con formato 'WIDTHxHEIGHT', por ejemplo '512x384'.
    """
    pixels_per_frame = min(base_pixels, MAX_TOTAL_PIXELS // max(n_frames, 1))

    if ratio is not None and ratio > 0:
        safe_ratio = max(ratio, 1e-6)
        w = max(MIN_GIF_DIM, int(math.sqrt(pixels_per_frame * safe_ratio)))
        h = max(MIN_GIF_DIM, int(w / safe_ratio))
    else:
        side = max(MIN_GIF_DIM, int(math.sqrt(pixels_per_frame)))
        w = h = side

    return f"{w}x{h}"


def build_base_collection(
    collection_id: str,
    band: str,
    bbox: list[float],
    start: str,
    end: str,
) -> ee.ImageCollection:
    """
    Filtra una colección GEE por banda, fecha y región, ordenada cronológicamente.

    Args:
        collection_id: ID de la colección en GEE (p. ej. 'MODIS/061/MOD13Q1').
        band: nombre de la banda a seleccionar.
        bbox: [minLon, minLat, maxLon, maxLat].
        start: fecha de inicio en formato 'YYYY-MM-DD'.
        end: fecha de fin en formato 'YYYY-MM-DD'.

    Returns:
        ImageCollection filtrada y ordenada por tiempo de inicio.
    """
    region = ee.Geometry.Rectangle(bbox)
    return (
        ee.ImageCollection(collection_id)
        .select([band])
        .filterDate(ee.Date(start), ee.Date(end))
        .filterBounds(region)
        .sort("system:time_start")
    )


# ---------------------------------------------------------------------------
# Temporadas
# ---------------------------------------------------------------------------

#: Mapeo de temporada → (mes-día inicio, mes-día fin).
#: Invierno se trata de forma especial porque cruza el cambio de año.
SEASON_RANGES: dict[str, tuple[str, str]] = {
    'invierno':  ('12-01', '02'),   # fin dinámico: 28 o 29 según año bisiesto
    'primavera': ('03-01', '05-31'),
    'verano':    ('06-01', '08-31'),
    'otono':     ('09-01', '11-30'),
    'anual':     ('01-01', '12-31'),
}

VALID_SEASONS: frozenset[str] = frozenset(SEASON_RANGES.keys())


def season_to_dates(year: int, season: str) -> tuple[str, str]:
    """
    Convierte año + temporada a un rango de fechas 'YYYY-MM-DD'.

    Temporadas aceptadas (valor de ``season``):
      * ``invierno``  → Y-12-01 .. (Y+1)-02-28/29 (año bisiesto)
      * ``primavera`` → Y-03-01 .. Y-05-31
      * ``verano``    → Y-06-01 .. Y-08-31
      * ``otono``     → Y-09-01 .. Y-11-30
      * ``anual``     → Y-01-01 .. Y-12-31

    Args:
        year   : año entero (p. ej. 2022).
        season : clave de temporada (cadena en minúsculas).

    Returns:
        Tupla ``(start, end)`` como cadenas ``'YYYY-MM-DD'``.

    Raises:
        ValueError: si la temporada no es válida.
    """
    if season not in VALID_SEASONS:
        raise ValueError(
            f"Temporada desconocida: '{season}'. "
            f"Opciones válidas: {sorted(VALID_SEASONS)}"
        )

    if season == 'invierno':
        end_year = year + 1
        end_day  = 29 if calendar.isleap(end_year) else 28
        return f"{year}-12-01", f"{end_year}-02-{end_day:02d}"

    start_suffix, end_suffix = SEASON_RANGES[season]
    return f"{year}-{start_suffix}", f"{year}-{end_suffix}"


# ---------------------------------------------------------------------------
# Validación de rangos de fecha
# ---------------------------------------------------------------------------


def check_max_10_years(start: str, end: str) -> Optional[str]:
    """
    Valida que el rango de fechas no supere 10 años y que el formato sea correcto.

    Returns:
        Mensaje de error como str si la validación falla, None si es válido.
    """
    try:
        d_start = datetime.strptime(start, "%Y-%m-%d")
        d_end   = datetime.strptime(end,   "%Y-%m-%d")
    except ValueError:
        return "Formato de fecha inválido. Usa YYYY-MM-DD."

    if d_end < d_start:
        return "La fecha fin debe ser posterior a la fecha inicio."

    years_span = (d_end - d_start).days / 365.25
    if years_span > MAX_YEARS_RANGE:
        return f"El rango de fechas excede el límite de {int(MAX_YEARS_RANGE)} años. Reduce el intervalo."

    return None

"""
Blueprint 'ts' — endpoints *-timeseries-bbox para todas las variables.
"""
import json

from flask import Blueprint, Response, jsonify, request

from gee.ndvi          import build_ndvi_timeseries_bbox
from gee.temperature   import build_era5_temp_timeseries_bbox
from gee.soil          import build_era5_soil_timeseries_bbox
from gee.precipitation import build_chirps_precip_timeseries_bbox
from gee.water         import build_water_timeseries_bbox
from gee.utils         import check_max_10_years, season_to_dates

ts_bp = Blueprint('ts', __name__)


def _parse_bbox(bbox_str: str) -> list[float]:
    bbox = json.loads(bbox_str)
    if not (isinstance(bbox, list) and len(bbox) == 4):
        raise ValueError("bbox inválido")
    return [float(v) for v in bbox]


def _timeseries_pipeline(
    build_ts_fn,
    ts_key: str,
    empty_error: str,
    validate_dates: bool = True,
) -> Response:
    """
    Implementación genérica para endpoints de serie temporal.

    Acepta dos modos de especificar el período:
    * Fechas directas : ``?start=YYYY-MM-DD&end=YYYY-MM-DD``
    * Año + temporada : ``?year=YYYY&season=<temporada>``

    Args:
        build_ts_fn    : función build_*_timeseries_bbox(start, end, bbox).
        ts_key         : clave del array de valores en la respuesta JSON.
        empty_error    : mensaje de error cuando no hay datos.
        validate_dates : si True, aplica la validación de rango de 10 años.
    """
    start    = request.args.get('start')
    end      = request.args.get('end')
    bbox_str = request.args.get('bbox')

    if not start or not end:
        year_str = request.args.get('year')
        season   = request.args.get('season')
        if year_str and season:
            try:
                start, end = season_to_dates(int(year_str), season)
            except (ValueError, TypeError):
                pass

    if not start or not end or not bbox_str:
        return jsonify({'error': 'Parámetros start, end y bbox son requeridos.'}), 400

    if validate_dates:
        err = check_max_10_years(start, end)
        if err:
            return jsonify({'error': err}), 400

    try:
        bbox = _parse_bbox(bbox_str)
    except Exception:
        return jsonify({'error': 'bbox debe ser un JSON [minLon,minLat,maxLon,maxLat].'}), 400

    try:
        dates, vals = build_ts_fn(start, end, bbox)
    except ValueError as e:
        return jsonify({'error': str(e)}), 400

    if not dates:
        return jsonify({'error': empty_error}), 400

    return jsonify({'dates': dates, ts_key: vals, 'bbox': bbox})


@ts_bp.get('/api/ndvi-timeseries-bbox')
def ndvi_timeseries_bbox() -> Response:
    """Serie temporal de NDVI medio (MODIS MOD13Q1)."""
    return _timeseries_pipeline(
        build_ts_fn=build_ndvi_timeseries_bbox,
        ts_key='ndvi',
        empty_error='No hay imágenes NDVI para ese rango / región.',
        validate_dates=False,
    )


@ts_bp.get('/api/era5-temp-timeseries-bbox')
def era5_temp_timeseries_bbox() -> Response:
    """Serie temporal de temperatura media diaria (ERA5-Land, °C)."""
    return _timeseries_pipeline(
        build_ts_fn=build_era5_temp_timeseries_bbox,
        ts_key='temp',
        empty_error='No hay datos de temperatura ERA5-Land para ese rango / región.',
    )


@ts_bp.get('/api/era5-soil-timeseries-bbox')
def era5_soil_timeseries_bbox() -> Response:
    """Serie temporal de humedad del suelo media diaria (ERA5-Land, %)."""
    return _timeseries_pipeline(
        build_ts_fn=build_era5_soil_timeseries_bbox,
        ts_key='soil_pct',
        empty_error='No hay datos de humedad del suelo ERA5-Land para ese rango / región.',
    )


@ts_bp.get('/api/imerg-precip-timeseries-bbox')
def imerg_precip_timeseries_bbox() -> Response:
    """Serie temporal de precipitación media diaria (CHIRPS, mm)."""
    return _timeseries_pipeline(
        build_ts_fn=build_chirps_precip_timeseries_bbox,
        ts_key='precip_mm',
        empty_error='No hay datos de precipitación CHIRPS para ese rango / región.',
    )


@ts_bp.get('/api/water-timeseries-bbox')
def water_timeseries_bbox() -> Response:
    """Serie temporal de área de agua superficial (Sentinel-2, ha)."""
    return _timeseries_pipeline(
        build_ts_fn=build_water_timeseries_bbox,
        ts_key='water_ha',
        empty_error='No hay observaciones de agua Sentinel-2 para ese rango / región.',
    )

"""
Blueprint 'station' — endpoint de series temporales de estaciones hidrológicas locales.
"""
from flask import Blueprint, Response, jsonify, request

from services.station_service import read_station_level_timeseries

station_bp = Blueprint('station', __name__)


@station_bp.get('/api/local-station-level-range')
def local_station_level_range() -> Response:
    """
    Devuelve el nivel hidrométrico de una estación local dentro del rango de fechas.

    Query params:
        station : ID de la estación ('SPTTB' o 'BDCTB').
        start   : Fecha de inicio 'YYYY-MM-DD'.
        end     : Fecha de fin 'YYYY-MM-DD'.

    Returns:
        JSON { station, dates, level_m }.
    """
    station_id = request.args.get('station')
    start      = request.args.get('start')
    end        = request.args.get('end')

    if not station_id or not start or not end:
        return jsonify({'error': "Parámetros 'station', 'start' y 'end' son requeridos."}), 400

    try:
        dates, levels = read_station_level_timeseries(station_id)
    except ValueError as e:
        return jsonify({'error': str(e)}), 400
    except FileNotFoundError as e:
        return jsonify({'error': str(e)}), 500

    filtered_dates  = [d for d in dates  if start <= d <= end]
    filtered_levels = [v for d, v in zip(dates, levels) if start <= d <= end]

    return jsonify({
        'station': station_id,
        'dates':   filtered_dates,
        'level_m': filtered_levels,
    })

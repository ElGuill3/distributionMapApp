"""
Blueprint 'station' — endpoint de series temporales de estaciones hidrológicas locales.
"""

from flask import Blueprint, Response, jsonify, request

from config import LOCAL_STATIONS
from extensions import limiter
from gee.schemas import LocalStationQuerySchema
from services.station_service import read_station_level_timeseries

station_bp = Blueprint("station", __name__)


@limiter.limit("60/minute")
@station_bp.get("/api/local-stations")
def local_stations() -> Response:
    """
    Devuelve los metadatos (nombre, tipo, coordenadas) de todas las estaciones locales disponibles.
    """
    stations_data = {}
    for key, info in LOCAL_STATIONS.items():
        stations_data[key] = {
            "name": info["name"],
            "type": info["type"],
            "coords": info.get("coords"),
            "station_name": info.get("station_name"),
            "municipio": info.get("municipio"),
        }
    return jsonify(stations_data)


@limiter.limit("60/minute")
@station_bp.get("/api/local-station-level-range")
def local_station_level_range() -> Response:
    """
    Devuelve la serie temporal de una estación local (nivel o precipitación) dentro del rango de fechas.

    Query params:
        station : ID de la estación (p. ej. 'BDCTB_hidro' o 'BDCTB_clima').
        start   : Fecha de inicio 'YYYY-MM-DD'.
        end     : Fecha de fin 'YYYY-MM-DD'.

    Returns:
        JSON con metadatos y listas filtradas.
    """
    station_raw = request.args.get("station")
    start_raw = request.args.get("start")
    end_raw = request.args.get("end")

    if not station_raw or not start_raw or not end_raw:
        return jsonify(
            {"error": "Parámetros 'station', 'start' y 'end' son requeridos."}
        ), 400

    try:
        query = LocalStationQuerySchema(station_id=station_raw, start=start_raw, end=end_raw)
    except Exception as e:
        return jsonify({"error": f"parámetros inválidos: {e}"}), 400

    try:
        dates, values = read_station_level_timeseries(query.station_id)
    except ValueError as e:
        return jsonify({"error": str(e)}), 400
    except FileNotFoundError as e:
        return jsonify({"error": str(e)}), 500

    filtered_dates = [d for d in dates if str(query.start) <= d <= str(query.end)]
    filtered_values = [
        v for d, v in zip(dates, values) if str(query.start) <= d <= str(query.end)
    ]

    station_info = LOCAL_STATIONS.get(query.station_id)
    station_type = station_info.get("type") if station_info else "hidrometrica"

    response_data = {
        "station": query.station_id,
        "type": station_type,
        "dates": filtered_dates,
    }

    if station_type == "climatolica":
        response_data["level_m"] = []
        response_data["precip_mm"] = filtered_values
        response_data["value"] = filtered_values
        response_data["unit"] = "mm"
    else:
        response_data["level_m"] = filtered_values
        response_data["precip_mm"] = []
        response_data["value"] = filtered_values
        response_data["unit"] = "m"

    return jsonify(response_data)

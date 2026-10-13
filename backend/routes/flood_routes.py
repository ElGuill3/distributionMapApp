"""
Blueprint 'flood' — susceptibilidad publicada y detección de inundaciones.
"""

import json
import logging

from flask import Blueprint, Response, abort, jsonify, request, send_from_directory

from backend.config import FLOOD_RISK_DIR, RATE_LIMITS
from backend.extensions import limiter
from backend.gee.schemas import (
    BBoxSchema,
    DateRangeSchema,
    _parse_bbox_str,
)

logger = logging.getLogger(__name__)

flood_bp = Blueprint("flood", __name__)


@flood_bp.get("/api/flood-risk/metadata")
def flood_risk_metadata() -> Response:
    """Classes, palette, tile template, sources and validation of the map."""
    try:
        metadata = json.loads((FLOOD_RISK_DIR / "metadata.json").read_text("utf-8"))
        metadata["tiles"]["url"] = "/api/flood-risk/" + metadata["tiles"]["url"]
    except (OSError, ValueError, KeyError, TypeError):
        logger.exception("Published flood susceptibility metadata is unavailable")
        return jsonify({"error": "El mapa de susceptibilidad no está disponible."}), 503
    return jsonify(metadata)


@flood_bp.get("/api/flood-risk/municipalities")
def flood_risk_municipalities() -> Response:
    """Municipality boundaries with class shares, mean score and rank."""
    return send_from_directory(
        FLOOD_RISK_DIR, "municipalities.geojson", mimetype="application/geo+json"
    )


@flood_bp.get("/api/flood-risk/tiles/<int:z>/<int:x>/<int:y>.png")
@limiter.exempt  # static files; a single map view requests dozens of tiles
def flood_risk_tile(z: int, x: int, y: int) -> Response:
    """Pre-rendered susceptibility tile (paletted PNG, Web Mercator)."""
    tiles = FLOOD_RISK_DIR / "tiles"
    if not (tiles / str(z) / str(x) / f"{y}.png").is_file():
        abort(404)
    return send_from_directory(tiles, f"{z}/{x}/{y}.png", mimetype="image/png")


@flood_bp.get("/api/flood-detection")
@limiter.limit(RATE_LIMITS["flood"])
def flood_detection() -> Response:
    """
    Detecta inundaciones utilizando Sentinel-1 o Landsat y devuelve
    las URLs de capas para Leaflet y el umbral calculado.
    """
    start_raw = request.args.get("start")
    end_raw = request.args.get("end")
    bbox_str = request.args.get("bbox")
    satellite = request.args.get("satellite", "sentinel1")
    use_auto = request.args.get("auto", "true").lower() == "true"

    threshold_str = request.args.get("threshold")
    threshold = -18.0
    if threshold_str:
        try:
            threshold = float(threshold_str)
        except ValueError:
            return jsonify({"error": "Umbral inválido."}), 400

    if not start_raw or not end_raw or not bbox_str:
        return jsonify({"error": "Parámetros start, end y bbox son requeridos."}), 400

    try:
        bbox_parsed_list = _parse_bbox_str(bbox_str)
        bbox_validado = BBoxSchema(
            min_lon=bbox_parsed_list[0],
            min_lat=bbox_parsed_list[1],
            max_lon=bbox_parsed_list[2],
            max_lat=bbox_parsed_list[3],
        )
        bbox_out = [
            bbox_validado.min_lon,
            bbox_validado.min_lat,
            bbox_validado.max_lon,
            bbox_validado.max_lat,
        ]
    except (ValueError, TypeError) as e:
        return jsonify({"error": f"bbox inválido: {e}"}), 400

    try:
        fecha_validada = DateRangeSchema(start=start_raw, end=end_raw)
        start_out = fecha_validada.start.strftime("%Y-%m-%d")
        end_out = fecha_validada.end.strftime("%Y-%m-%d")
    except (ValueError, TypeError) as e:
        return jsonify({"error": f"fechas inválidas: {e}"}), 400

    try:
        from backend.gee.water import detect_floods_bbox

        res = detect_floods_bbox(
            start=start_out,
            end=end_out,
            bbox=bbox_out,
            satellite=satellite,
            use_auto_threshold=use_auto,
            threshold=threshold,
        )
        if res is None:
            return jsonify(
                {"error": "No se encontraron imágenes en esta zona/fecha."}
            ), 404
        return jsonify(res)
    except Exception as e:
        logger.exception("Error en flood_detection: %s", e)
        return jsonify({"error": f"Error interno al detectar inundación: {e}"}), 500


@flood_bp.get("/api/flood-stats")
@limiter.limit(RATE_LIMITS["flood_stats"])
def flood_stats() -> Response:
    """
    Calcula el área de inundación en hectáreas.
    """
    start_raw = request.args.get("start")
    end_raw = request.args.get("end")
    bbox_str = request.args.get("bbox")
    satellite = request.args.get("satellite", "sentinel1")
    use_auto = request.args.get("auto", "true").lower() == "true"

    threshold_str = request.args.get("threshold")
    threshold = -18.0
    if threshold_str:
        try:
            threshold = float(threshold_str)
        except ValueError:
            return jsonify({"error": "Umbral inválido."}), 400

    if not start_raw or not end_raw or not bbox_str:
        return jsonify({"error": "Parámetros start, end y bbox son requeridos."}), 400

    try:
        bbox_parsed_list = _parse_bbox_str(bbox_str)
        bbox_validado = BBoxSchema(
            min_lon=bbox_parsed_list[0],
            min_lat=bbox_parsed_list[1],
            max_lon=bbox_parsed_list[2],
            max_lat=bbox_parsed_list[3],
        )
        bbox_out = [
            bbox_validado.min_lon,
            bbox_validado.min_lat,
            bbox_validado.max_lon,
            bbox_validado.max_lat,
        ]
    except (ValueError, TypeError) as e:
        return jsonify({"error": f"bbox inválido: {e}"}), 400

    try:
        fecha_validada = DateRangeSchema(start=start_raw, end=end_raw)
        start_out = fecha_validada.start.strftime("%Y-%m-%d")
        end_out = fecha_validada.end.strftime("%Y-%m-%d")
    except (ValueError, TypeError) as e:
        return jsonify({"error": f"fechas inválidas: {e}"}), 400

    try:
        from backend.gee.water import calculate_flood_area

        total_ha = calculate_flood_area(
            start=start_out,
            end=end_out,
            bbox=bbox_out,
            satellite=satellite,
            use_auto_threshold=use_auto,
            threshold=threshold,
        )
        return jsonify({"total_ha": round(total_ha, 2)})
    except Exception as e:
        logger.exception("Error en flood_stats: %s", e)
        return jsonify({"error": f"Error interno al calcular estadísticas: {e}"}), 500

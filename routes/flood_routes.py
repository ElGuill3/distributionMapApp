"""
Blueprint 'flood' — endpoint de mapas de riesgo de inundación por municipio.
"""

import logging

from flask import Blueprint, Response, jsonify, request

from extensions import limiter

logger = logging.getLogger(__name__)

from config import MUNICIPAL_TIFS
from gee.flood_risk import render_flood_risk_png
from gee.schemas import MuniQuerySchema, BBoxSchema, DateRangeSchema, _parse_bbox_str

flood_bp = Blueprint("flood", __name__)


@limiter.limit("60/minute")
@flood_bp.get("/api/flood-risk-municipio")
def flood_risk_municipio() -> Response:
    """
    Genera (o usa el caché local) el PNG de riesgo de inundación para el municipio.

    Query params:
        muni    : clave del municipio (p. ej. 'centla').
        palette : paleta de colores (default 'gee_flood').

    Returns:
        JSON { mapUrl, bbox } con la URL relativa del PNG y su bounding box.
    """
    muni_raw = request.args.get("muni")
    palette_raw = request.args.get("palette", "gee_flood")

    if not muni_raw:
        return jsonify({"error": "Parámetro muni es requerido."}), 400

    try:
        query = MuniQuerySchema(muni=muni_raw, palette=palette_raw)
    except Exception as e:
        return jsonify({"error": f"municipio inválido: {e}"}), 400

    tif_path = MUNICIPAL_TIFS.get(query.muni)
    if tif_path is None:
        return jsonify({"error": "Municipio no soportado."}), 400

    try:
        map_url, bbox = render_flood_risk_png(tif_path, query.palette)
    except ValueError as e:
        return jsonify({"error": str(e)}), 400
    except Exception as e:
        logger.exception("Error en flood_risk_municipio: %s", e)
        return jsonify({"error": "Error interno al generar el mapa de riesgo."}), 500

    return jsonify({"mapUrl": map_url, "bbox": bbox})


@limiter.limit("60/minute")
@flood_bp.get("/api/flood-detection")
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
        from gee.water import detect_floods_bbox
        res = detect_floods_bbox(
            start=start_out,
            end=end_out,
            bbox=bbox_out,
            satellite=satellite,
            use_auto_threshold=use_auto,
            threshold=threshold,
        )
        if res is None:
            return jsonify({"error": "No se encontraron imágenes en esta zona/fecha."}), 404
        return jsonify(res)
    except Exception as e:
        logger.exception("Error en flood_detection: %s", e)
        return jsonify({"error": f"Error interno al detectar inundación: {e}"}), 500


@limiter.limit("30/minute")
@flood_bp.get("/api/flood-stats")
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
        from gee.water import calculate_flood_area
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


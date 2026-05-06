"""
Blueprint 'flood' — endpoint de mapas de riesgo de inundación por municipio.
"""

import logging

from flask import Blueprint, Response, jsonify, request

from extensions import limiter

logger = logging.getLogger(__name__)

from gee.flood_risk import render_flood_risk_png
from gee.schemas import MuniQuerySchema
from config import MUNICIPAL_TIFS

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

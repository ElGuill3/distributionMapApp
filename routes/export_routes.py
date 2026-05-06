"""
Blueprint 'export' — endpoint para exportar análisis como ZIP.

Responsabilidades:
  - Validar petición de exportación con ExportRequestSchema.
  - Serializar series temporales a CSV.
  - Copiar GIFs del disco y empaquetarlos en ZIP con metadata.json.
  - Devolver el ZIP como descarga.
"""
import logging
from datetime import datetime
from io import BytesIO
from pathlib import Path

from flask import Blueprint, Response, jsonify, request
from pydantic import ValidationError

from extensions import limiter

from config import GIFS_DIR, STATIC_DIR
from gee.schemas import ExportRequestSchema
from services.export_service import create_export_zip, serialize_series_to_csv

logger = logging.getLogger(__name__)

export_bp = Blueprint("export", __name__)


@limiter.limit("10/minute")
@export_bp.route("/api/export/bundle", methods=["POST"])
def export_bundle() -> Response:
    """
    Genera y devuelve un ZIP con timeseries.csv, GIFs opcionales y metadata.json.

    Request body (JSON):
        gifPaths   : list[str] — rutas relativas a static/ ej ["gifs/ndvi_abc123.gif"]
        panel      : "A" | "B"
        seriesData : { dates: list[str], variables: dict<string, list<float|null>> }
        bbox       : list[float]
        metadata   : { variableKeys: list[str], panel: "A"|"B" }

    Returns:
        ZIP file (application/zip) con Content-Disposition para descarga.

    Errors:
        400: body malformado o validación falla
        404: algún GIF en gifPaths no existe en disco
    """
    # 1. Parsear y validar body con Pydantic
    if not request.is_json:
        return jsonify({"error": "Invalid request body"}), 400

    try:
        payload = ExportRequestSchema.model_validate(request.json)
    except ValidationError:
        return jsonify({"error": "Invalid request body"}), 400

    # 2. Normalizar rutas de GIF: quitar "/static/" si viene prefixado
    # (el frontend envía "/static/gifs/..." pero STATIC_DIR ya incluye "static/")
    normalized_gif_paths = [
        p.removeprefix("/static/") for p in payload.gifPaths
    ]

    # 3. Validar que cada GIF exista en disco
    for gif_path in normalized_gif_paths:
        full_path = STATIC_DIR / gif_path
        if not full_path.exists():
            logger.warning("GIF no encontrado: %s", gif_path)
            return jsonify(
                {"error": "Animation file no longer available. Please regenerate the animation."}
            ), 404

    # 3. Serializar series a CSV
    try:
        csv_content = serialize_series_to_csv(
            series_data=payload.seriesData.variables,
            dates=payload.seriesData.dates,
            bbox=payload.bbox,
            variable_keys=payload.metadata.variableKeys,
        )
    except (ValueError, KeyError) as e:
        logger.warning("Error serializando CSV: %s", e)
        return jsonify({"error": "Invalid request body"}), 400

    # 4. Construir metadata
    metadata = {
        "variableKeys": payload.metadata.variableKeys,
        "panel": payload.metadata.panel,
        "bbox": payload.bbox,
    }

    # 5. Crear ZIP en memoria
    try:
        zip_bytes = create_export_zip(
            csv_content=csv_content,
            gif_paths=normalized_gif_paths,
            metadata=metadata,
        )
    except FileNotFoundError as e:
        logger.warning("GIF no encontrado al crear ZIP: %s", e)
        return jsonify(
            {"error": "Animation file no longer available. Please regenerate the animation."}
        ), 404

    # 6. Preparar nombre de archivo con timestamp
    timestamp = datetime.now().strftime("%Y%m%d_%H%M%S")
    filename = f"analysis_export_{timestamp}.zip"

    # 7. Devolver ZIP
    buffer = BytesIO(zip_bytes)
    buffer.seek(0)

    response = Response(
        buffer.read(),
        mimetype="application/zip",
        headers={
            "Content-Disposition": f"attachment; filename={filename}",
            "Content-Length": str(len(zip_bytes)),
        },
    )
    return response

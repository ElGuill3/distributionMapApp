"""
Blueprint 'export' — endpoint para exportar análisis como ZIP y PDF.

Responsabilidades:
  - Validar petición de exportación con ExportRequestSchema.
  - Serializar series temporales a CSV.
  - Copiar GIFs del disco y empaquetarlos en ZIP con metadata.json.
  - Devolver el ZIP como descarga.
  - Generar reportes PDF con WeasyPrint (POST /api/export/pdf-report).
"""
import logging
from datetime import datetime
from io import BytesIO
from pathlib import Path

from flask import Blueprint, Response, jsonify, request
from pydantic import ValidationError

from extensions import limiter

from config import GIFS_DIR, STATIC_DIR
from gee.schemas import ExportRequestSchema, PdfReportRequestSchema
from services.export_service import create_export_zip, serialize_series_to_csv
from services.pdf_report_service import (
    build_pdf_context,
    compute_statistics,
    detect_anomalies,
    extract_middle_frame,
    render_pdf_report,
)

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


@limiter.limit("10/minute")
@export_bp.route("/api/export/pdf-report", methods=["POST"])
def export_pdf_report() -> Response:
    """
    Genera y devuelve un PDF report con gráfica, frame del GIF y estadísticas.

    Request body (JSON):
        chart_blob : str — PNG del chart codificado en base64
        gif_path   : str — ruta relativa al GIF, ej "gifs/ndvi_abc123.gif"
        seriesData : { dates: list[str], variables: dict<string, list<float|null>> }
        bbox       : list[float]
        metadata   : { variableKeys: list[str], panel: "A"|"B" }

    Returns:
        PDF binary (application/pdf) con Content-Disposition para descarga.

    Errors:
        400: body malformado o validación falla
        404: GIF no encontrado en disco
        500: error interno al generar PDF (WeasyPrint, etc.)
    """
    # 1. Verificar que el body es JSON
    if not request.is_json:
        return jsonify({"error": "Invalid request body"}), 400

    # 2. Parsear y validar con PdfReportRequestSchema
    try:
        payload = PdfReportRequestSchema.model_validate(request.json)
    except ValidationError as e:
        logger.warning("ValidationError en pdf-report: %s", e)
        return jsonify({"error": "Invalid request body"}), 400

    # 3. Validar que seriesData no esté vacío (después de la validación de schema)
    if not payload.series_data.dates:
        return jsonify({"error": "Invalid request body"}), 400

    # 4. Extraer frame del medio del GIF (con caché)
    gif_frame_path = None
    if payload.gif_path:
        try:
            gif_frame_path = extract_middle_frame(payload.gif_path)
        except FileNotFoundError:
            logger.warning("GIF no encontrado para PDF: %s", payload.gif_path)
            return jsonify(
                {"error": "Animation file no longer available. Please regenerate the animation."}
            ), 404

    # 5. Calcular estadísticas
    stats = compute_statistics(
        series_data=payload.series_data.variables,
        dates=payload.series_data.dates,
    )

    anomaly_result = detect_anomalies(
        series_data=payload.series_data.variables,
        dates=payload.series_data.dates,
    )

    # 7. Construir contexto para la plantilla
    context = build_pdf_context(
        series_data=payload.series_data.variables,
        dates=payload.series_data.dates,
        stats=stats,
        chart_blob=payload.chart_blob,
        gif_frame_path=gif_frame_path,
        bbox=payload.bbox,
        metadata=payload.metadata.model_dump(),
        anomaly_result=anomaly_result,
    )

    # 8. Renderizar PDF
    try:
        pdf_bytes = render_pdf_report(context)
    except RuntimeError as e:
        logger.error("Error generando PDF: %s", e)
        return jsonify({"error": str(e)}), 500
    except Exception as e:
        logger.error("Error inesperado generando PDF: %s", e)
        return jsonify({"error": "Failed to generate PDF report."}), 500

    # 8. Preparar nombre de archivo con timestamp
    timestamp = datetime.now().strftime("%Y%m%d_%H%M%S")
    filename = f"analysis_report_{timestamp}.pdf"

    # 9. Devolver PDF
    buffer = BytesIO(pdf_bytes)
    buffer.seek(0)

    response = Response(
        buffer.read(),
        mimetype="application/pdf",
        headers={
            "Content-Disposition": f"attachment; filename={filename}",
            "Content-Length": str(len(pdf_bytes)),
        },
    )
    return response

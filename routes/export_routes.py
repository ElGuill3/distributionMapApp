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

from flask import Blueprint, Response, jsonify, request
from pydantic import ValidationError
import queue

from config import STATIC_DIR
from extensions import limiter
from gee.schemas import ExportRequestSchema, PdfReportRequestSchema
from services.export_service import create_export_zip, serialize_series_to_csv
from services.gif_service import progress_queues, remove_progress_queue
from services.pdf_report_service import (
    build_pdf_context,
    compute_statistics,
    generate_ai_report,
    extract_frame_for_date,
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
        seriesData : { dates: list[str], variables: dict<string, list<float|null>> }
        bbox       : list[float]
        metadata   : { variableKeys: list[str] }

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
    normalized_gif_paths = [p.removeprefix("/static/") for p in payload.gifPaths]

    # 3. Validar que cada GIF exista en disco
    for gif_path in normalized_gif_paths:
        full_path = STATIC_DIR / gif_path
        if not full_path.exists():
            logger.warning("GIF no encontrado: %s", gif_path)
            return jsonify(
                {
                    "error": (
                        "Animation file no longer available. "
                        "Please regenerate the animation."
                    )
                }
            ), 404

    # 4. Serializar series a CSV
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

    # 5. Construir metadata
    metadata = {
        "variableKeys": payload.metadata.variableKeys,
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
            {
                "error": (
                    "Animation file no longer available. "
                    "Please regenerate the animation."
                )
            }
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
    Genera y devuelve un PDF report con análisis de IA y fotograma del GIF seleccionado.
    Opcionalmente acepta un 'task_id' para reportar progreso vía SSE.
    """
    task_id = request.args.get("task_id")
    pq = None
    if task_id:
        pq = queue.Queue()
        progress_queues[task_id] = pq

    def _progress(percent: int, message: str) -> None:
        if pq:
            pq.put({"progress": percent, "message": message})

    def _error(message: str) -> None:
        if pq:
            pq.put({"progress": -1, "message": message})
            pq.put(None)
            remove_progress_queue(task_id)

    def _done() -> None:
        if pq:
            pq.put({"progress": 100, "message": "Listo"})
            pq.put(None)
            remove_progress_queue(task_id)

    _progress(10, "Validando datos del reporte...")

    if not request.is_json:
        _error("El cuerpo de la solicitud no es JSON válido")
        return jsonify({"error": "Invalid request body"}), 400

    try:
        payload = PdfReportRequestSchema.model_validate(request.json)
    except ValidationError as e:
        logger.warning("ValidationError en pdf-report: %s", e)
        _error("Datos de solicitud inválidos")
        return jsonify({"error": "Invalid request body"}), 400

    if not payload.series_data.dates:
        _error("La serie de datos está vacía")
        return jsonify({"error": "Invalid request body"}), 400

    _progress(20, "Calculando estadísticas históricas...")
    stats = compute_statistics(
        series_data=payload.series_data.variables,
        dates=payload.series_data.dates,
    )

    _progress(35, "Iniciando análisis de la IA...")
    try:
        def on_ai_status(msg: str) -> None:
            # We scale the progress incrementally in the 35% to 65% range as the AI streams reasoning
            _progress(35, msg)

        ai_report = generate_ai_report(
            series_data=payload.series_data.variables,
            dates=payload.series_data.dates,
            bbox=payload.bbox,
            stats=stats,
            on_status_update=on_ai_status
        )
    except Exception as e:
        logger.error("Error llamando a MiniMax M3: %s", e)
        _error(f"Error de IA: {str(e)}")
        return jsonify({"error": f"Failed to generate report with AI: {str(e)}"}), 500

    _progress(70, "Analizando y extrayendo fotograma del mapa...")
    gif_frame_path = None
    if payload.gif_path:
        try:
            gif_frame_path = extract_frame_for_date(
                gif_path=payload.gif_path,
                event_start_date=ai_report["selected_date"],
                dates=payload.series_data.dates
            )
        except FileNotFoundError:
            logger.warning("GIF no encontrado para PDF: %s", payload.gif_path)
            _error("Archivo de animación no encontrado")
            return jsonify(
                {
                    "error": (
                        "Animation file no longer available. "
                        "Please regenerate the animation."
                    )
                }
            ), 404
        except Exception as e:
            logger.warning(
                "No se pudo extraer el fotograma para la fecha %s: %s",
                ai_report["selected_date"], e
            )
            # Intentar obtener el del medio como fallback de extracción
            try:
                mid_idx = len(payload.series_data.dates) // 2
                gif_frame_path = extract_frame_for_date(
                    gif_path=payload.gif_path,
                    event_start_date=payload.series_data.dates[mid_idx],
                    dates=payload.series_data.dates
                )
            except Exception:
                pass

    _progress(85, "Compilando reporte PDF con WeasyPrint...")
    
    # Convertimos el fotograma extraído a un data URI base64. Esto evita problemas de acceso a disco
    # por parte de WeasyPrint y asegura que la imagen del mapa se renderice correctamente en cualquier entorno.
    gif_frame_uri = None
    if gif_frame_path:
        try:
            import base64
            from pathlib import Path
            path_obj = Path(gif_frame_path)
            if path_obj.exists():
                with open(path_obj, "rb") as image_file:
                    encoded_string = base64.b64encode(image_file.read()).decode("utf-8")
                    gif_frame_uri = f"data:image/png;base64,{encoded_string}"
        except Exception as e:
            logger.warning("Error al codificar el fotograma del mapa a base64: %s", e)

    context = build_pdf_context(
        series_data=payload.series_data.variables,
        dates=payload.series_data.dates,
        stats=stats,
        chart_blob=payload.chart_blob,
        gif_frame_path=gif_frame_uri or gif_frame_path,
        bbox=payload.bbox,
        metadata=payload.metadata.model_dump(),
        report_html=ai_report["report_html"],
        spatial_caption=ai_report["frame_caption"],
    )

    try:
        pdf_bytes = render_pdf_report(context)
    except RuntimeError as e:
        logger.error("Error generando PDF: %s", e)
        _error(f"Error en WeasyPrint: {str(e)}")
        return jsonify({"error": str(e)}), 500
    except Exception as e:
        logger.error("Error inesperado generando PDF: %s", e)
        _error("Error inesperado al compilar PDF")
        return jsonify({"error": "Failed to generate PDF report."}), 500

    _done()

    # Preparar nombre de archivo con timestamp
    timestamp = datetime.now().strftime("%Y%m%d_%H%M%S")
    filename = f"analysis_report_{timestamp}.pdf"

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

"""
Blueprint 'gif' — endpoints *-gif-bbox para todas las variables.

Cada endpoint:
  1. Valida parámetros de entrada (start, end, bbox, ratio, task_id).
  2. Crea una cola de progreso SSE si se proporciona task_id.
  3. Delega en el módulo GEE correspondiente para obtener la URL del GIF de GEE.
  4. Obtiene las fechas vía la función de serie temporal del mismo módulo.
  5. Llama a gif_service.add_dates_to_gif() para descargar, anotar y guardar.
  6. Devuelve { gifUrl, bbox, dates, <variable>: valores }.
"""

import hashlib
import json
import logging
import queue
from typing import Optional

from flask import Blueprint, Response, jsonify, request

logger = logging.getLogger(__name__)

from extensions import limiter

from gee.ndvi import build_ndvi_gif_bbox, build_ndvi_timeseries_bbox
from gee.temperature import build_era5_temp_gif_bbox, build_era5_temp_timeseries_bbox
from gee.soil import build_era5_soil_gif_bbox, build_era5_soil_timeseries_bbox
from gee.precipitation import (
    build_chirps_precip_gif_bbox,
    build_chirps_precip_timeseries_bbox,
)
from gee.water import build_water_gif_bbox, build_water_timeseries_bbox
from gee.schemas import BBoxSchema, DateRangeSchema, _parse_bbox_str
from gee.utils import check_max_10_years, season_to_dates
from services.gif_service import (
    add_dates_to_gif,
    progress_queues,
)
from config import GIFS_DIR

gif_bp = Blueprint("gif", __name__)

# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------


def _parse_common_params() -> tuple[
    Optional[str], Optional[str], Optional[list[float]], Optional[float], Optional[str]
]:
    """
    Extrae start, end, bbox, ratio y task_id de la query string.

    Acepta dos modos:
    * Fechas directas : ``?start=YYYY-MM-DD&end=YYYY-MM-DD``
    * Año + temporada : ``?year=YYYY&season=<temporada>``
      (convertido internamente con :func:`season_to_dates`)
    """
    start = request.args.get("start")
    end = request.args.get("end")
    bbox_str = request.args.get("bbox")
    ratio_str = request.args.get("ratio")
    task_id = request.args.get("task_id")

    if not start or not end:
        year_str = request.args.get("year")
        season = request.args.get("season")
        if year_str and season:
            try:
                start, end = season_to_dates(int(year_str), season)
            except (ValueError, TypeError):
                pass  # la validación posterior emitirá el error adecuado

    return start, end, bbox_str, ratio_str, task_id


def _parse_bbox(bbox_str: str) -> list[float]:
    """Parsea el JSON del bbox y valida su estructura."""
    bbox = json.loads(bbox_str)
    if not (isinstance(bbox, list) and len(bbox) == 4):
        raise ValueError("bbox inválido")
    return [float(v) for v in bbox]


def _make_progress_callback(pq: Optional[queue.Queue]):
    """Devuelve una función de callback que escribe en la cola de progreso."""

    def _cb(percent: int, message: str) -> None:
        if pq:
            pq.put({"progress": percent, "message": message})

    return _cb


def _setup_progress(task_id: Optional[str]) -> Optional[queue.Queue]:
    """Crea y registra la cola SSE si hay task_id."""
    if not task_id:
        return None
    pq = queue.Queue()
    progress_queues[task_id] = pq
    return pq


def _signal_error(pq: Optional[queue.Queue], message: str) -> None:
    if pq:
        pq.put({"progress": -1, "message": message})
        pq.put(None)


def _signal_done(pq: Optional[queue.Queue]) -> None:
    if pq:
        pq.put(None)


def _gif_pipeline(
    variable_prefix: str,
    build_gif_fn,
    build_ts_fn,
    ts_key: str,
    font_size: int,
    start_message: str,
    *,
    bbox_parsed: Optional[list[float]] = None,
    start_parsed: Optional[str] = None,
    end_parsed: Optional[str] = None,
) -> Response:
    """
    Implementación genérica del pipeline GIF:
      parse → queue → build GEE URL → get dates → PIL → save → response.

    Args:
        variable_prefix : prefijo para el nombre de archivo (p. ej. 'ndvi').
        build_gif_fn    : función build_*_gif_bbox(start, end, bbox, ratio).
        build_ts_fn     : función build_*_timeseries_bbox(start, end, bbox).
        ts_key          : clave del array de valores en la respuesta JSON.
        font_size       : tamaño de la fuente para las fechas en el GIF.
        start_message   : mensaje inicial para la cola SSE.
        bbox_parsed    : bbox pre-validado (list[float]) — si se provee, saltea parseo.
        start_parsed    : fecha inicio pre-validada (YYYY-MM-DD) — si se provee, saltea validación.
        end_parsed      : fecha fin pre-validada (YYYY-MM-DD) — si se provee, saltea validación.
    """
    # ratio_str y task_id siempre vienen de request.args (no se pre-validan).
    ratio_str = request.args.get("ratio")
    task_id = request.args.get("task_id")

    if bbox_parsed is not None:
        # Ruta de validación externa (ndvi_gif_bbox): params ya validados con Pydantic.
        start = start_parsed
        end = end_parsed
        bbox = bbox_parsed
    else:
        # Ruta estándar: extraer y validar.
        start, end, bbox_str, ratio_str, task_id = _parse_common_params()

        if not start or not end or not bbox_str:
            return jsonify(
                {"error": "Parámetros start, end y bbox son requeridos."}
            ), 400

        err = check_max_10_years(start, end)
        if err:
            return jsonify({"error": err}), 400

        try:
            bbox = _parse_bbox(bbox_str)
        except Exception:
            return jsonify(
                {"error": "bbox debe ser un JSON [minLon,minLat,maxLon,maxLat]."}
            ), 400

    ratio = float(ratio_str) if ratio_str else None

    # --- Cache hit check: computar clave ANTES de llamar a GEE ---
    bbox_hash = hashlib.md5(str(bbox).encode()).hexdigest()[:8]
    output_filename = f"{variable_prefix}_{start}_{end}_{bbox_hash}.gif"
    output_path = GIFS_DIR / output_filename

    # Si el GIF ya existe y tiene tamaño > 0, es cache HIT
    if output_path.exists() and output_path.stat().st_size > 0:
        try:
            dates, vals = build_ts_fn(start, end, bbox)
            if dates:
                logger.info("GIF cache HIT: %s", output_filename)
                return jsonify(
                    {
                        "gifUrl": f"/static/gifs/{output_filename}",
                        "bbox": bbox,
                        "dates": dates,
                        ts_key: vals,
                    }
                )
            # Si timeseries falla, caer al path de regeneración
            logger.warning("Timeseries falló en cache HIT, regenerando: %s", output_filename)
        except Exception:
            # Si timeseries falla en cache hit, caer al path de regeneración
            logger.warning("Excepción en timeseries durante cache HIT, regenerando: %s", output_filename)

    # --- Cache MISS: generar GIF desde GEE ---
    pq = _setup_progress(task_id)
    callback = _make_progress_callback(pq)

    try:
        if pq:
            pq.put({"progress": 0, "message": start_message})

        ee_gif_url = build_gif_fn(start, end, bbox, ratio)
        if not ee_gif_url:
            _signal_error(pq, f"No hay datos de {variable_prefix}")
            return jsonify(
                {"error": f"No hay datos de {variable_prefix} para ese rango/región."}
            ), 400

        dates, vals = build_ts_fn(start, end, bbox)
        if not dates:
            _signal_error(pq, "No se pudieron obtener fechas")
            return jsonify({"error": "No se pudieron obtener las fechas."}), 400

        add_dates_to_gif(
            gif_url=ee_gif_url,
            dates=dates,
            output_path=str(output_path),
            font_size=font_size,
            position="top-left",
            progress_callback=callback,
        )

        _signal_done(pq)

        return jsonify(
            {
                "gifUrl": f"/static/gifs/{output_filename}",
                "bbox": bbox,
                "dates": dates,
                ts_key: vals,
            }
        )

    except ValueError as e:
        _signal_error(pq, str(e))
        return jsonify({"error": str(e)}), 400
    except Exception as e:
        logger.exception("Error en endpoint GIF %s: %s", variable_prefix, e)
        _signal_error(pq, f"Error: {str(e)}")
        return jsonify({"error": f"Error interno: {str(e)}"}), 500


# ---------------------------------------------------------------------------
# Endpoints
# ---------------------------------------------------------------------------


@limiter.limit("30/minute")
@gif_bp.get("/api/ndvi-gif-bbox")
def ndvi_gif_bbox() -> Response:
    """
    Genera el GIF animado de NDVI (MODIS MOD13Q1) para el bbox indicado.

    Validación Pydantic (BBoxSchema + DateRangeSchema) antes de llamar a
    _gif_pipeline para garantizar que bbox y fechas son correctos antes de
    cualquier llamada a GEE.
    """
    start_raw = request.args.get("start")
    end_raw = request.args.get("end")
    bbox_str = request.args.get("bbox")

    # 1. Parseo + validación de bbox con Pydantic
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

    # 2. Validación de fechas con Pydantic
    try:
        fecha_validada = DateRangeSchema(start=start_raw, end=end_raw)
        start_out = fecha_validada.start.strftime("%Y-%m-%d")
        end_out = fecha_validada.end.strftime("%Y-%m-%d")
    except (ValueError, TypeError) as e:
        return jsonify({"error": f"fecha inválida: {e}"}), 400

    # 3. Llamar a _gif_pipeline con params ya validados
    return _gif_pipeline(
        variable_prefix="ndvi",
        build_gif_fn=build_ndvi_gif_bbox,
        build_ts_fn=build_ndvi_timeseries_bbox,
        ts_key="ndvi",
        font_size=20,
        start_message="Iniciando generación de NDVI...",
        bbox_parsed=bbox_out,
        start_parsed=start_out,
        end_parsed=end_out,
    )


@limiter.limit("30/minute")
@gif_bp.get("/api/era5-temp-gif-bbox")
def era5_temp_gif_bbox() -> Response:
    """Genera el GIF animado de temperatura del aire (ERA5-Land) para el bbox."""
    return _gif_pipeline(
        variable_prefix="temp",
        build_gif_fn=build_era5_temp_gif_bbox,
        build_ts_fn=build_era5_temp_timeseries_bbox,
        ts_key="temp",
        font_size=10,
        start_message="Iniciando generación de temperatura...",
    )


@limiter.limit("30/minute")
@gif_bp.get("/api/era5-soil-gif-bbox")
def era5_soil_gif_bbox() -> Response:
    """Genera el GIF animado de humedad del suelo (ERA5-Land) para el bbox."""
    return _gif_pipeline(
        variable_prefix="soil",
        build_gif_fn=build_era5_soil_gif_bbox,
        build_ts_fn=build_era5_soil_timeseries_bbox,
        ts_key="soil_pct",
        font_size=10,
        start_message="Iniciando generación de humedad del suelo...",
    )


@limiter.limit("30/minute")
@gif_bp.get("/api/imerg-precip-gif-bbox")
def imerg_precip_gif_bbox() -> Response:
    """Genera el GIF animado de precipitación (CHIRPS) para el bbox."""
    return _gif_pipeline(
        variable_prefix="precip",
        build_gif_fn=build_chirps_precip_gif_bbox,
        build_ts_fn=build_chirps_precip_timeseries_bbox,
        ts_key="precip_mm",
        font_size=10,
        start_message="Iniciando generación de precipitación...",
    )


@limiter.limit("30/minute")
@gif_bp.get("/api/water-gif-bbox")
def water_gif_bbox() -> Response:
    """Genera el GIF animado de cuerpos de agua (Sentinel-2) para el bbox."""
    return _gif_pipeline(
        variable_prefix="water",
        build_gif_fn=build_water_gif_bbox,
        build_ts_fn=build_water_timeseries_bbox,
        ts_key="water_ha",
        font_size=10,
        start_message="Iniciando generación de cuerpos de agua...",
    )

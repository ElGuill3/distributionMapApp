"""
Servicio de generación y gestión de GIFs animados.

Responsabilidades:
  - Descargar GIFs de Earth Engine, superponer fechas con PIL y guardarlos.
  - Limpiar GIFs expirados del directorio local (hilo daemon en segundo plano).
  - Gestionar el diccionario global de colas de progreso (SSE).
"""
import logging
import queue
import threading
import time
from io import BytesIO
from typing import Callable, Optional

import requests
from PIL import Image as PILImage, ImageDraw, ImageFont, ImageSequence

from config import GIFS_DIR, GIF_CLEANUP_INTERVAL_S, GIF_DOWNLOAD_TIMEOUT_S, GIF_MAX_AGE_MINUTES

logger = logging.getLogger(__name__)

# ---------------------------------------------------------------------------
# Sistema de progreso SSE
# ---------------------------------------------------------------------------

# Diccionario global: task_id → Queue[dict | None]
progress_queues: dict[str, queue.Queue] = {}


def create_progress_queue(task_id: str) -> queue.Queue:
    """Crea y registra una cola de progreso para la tarea indicada."""
    q = queue.Queue()
    progress_queues[task_id] = q
    return q


def remove_progress_queue(task_id: str) -> None:
    """Elimina la cola de progreso de una tarea finalizada."""
    progress_queues.pop(task_id, None)


# ---------------------------------------------------------------------------
# Limpieza automática de GIFs
# ---------------------------------------------------------------------------

def cleanup_old_gifs(max_age_minutes: int = GIF_MAX_AGE_MINUTES) -> None:
    """
    Elimina periódicamente los GIFs más antiguos que max_age_minutes.
    Diseñado para ejecutarse en un hilo daemon.
    """
    while True:
        try:
            cutoff_time = time.time() - (max_age_minutes * 60)
            count = 0
            for gif_file in GIFS_DIR.glob("*.gif"):
                try:
                    if gif_file.stat().st_mtime < cutoff_time:
                        gif_file.unlink()
                        count += 1
                        logger.info("Eliminado GIF antiguo: %s", gif_file.name)
                except Exception as e:
                    logger.error("Error eliminando %s: %s", gif_file.name, e)
            if count > 0:
                logger.info("Limpieza automática: %d GIFs eliminados (>=%d min)", count, max_age_minutes)
        except Exception as e:
            logger.error("Error en limpieza automática: %s", e)
        time.sleep(GIF_CLEANUP_INTERVAL_S)


def cleanup_pattern_gifs(pattern: str) -> None:
    """
    Elimina los GIFs cuyo nombre coincida con el patrón glob indicado.

    Args:
        pattern: patrón glob relativo a GIFS_DIR (p. ej. 'ndvi_*_abc123.gif').
    """
    try:
        for gif_file in GIFS_DIR.glob(pattern):
            try:
                gif_file.unlink()
                logger.info("Eliminado GIF previo: %s", gif_file.name)
            except Exception as e:
                logger.error("Error eliminando %s: %s", gif_file.name, e)
    except Exception as e:
        logger.error("Error en cleanup_pattern_gifs: %s", e)


def start_cleanup_daemon() -> None:
    """Lanza el hilo daemon de limpieza automática."""
    t = threading.Thread(target=cleanup_old_gifs, args=(GIF_MAX_AGE_MINUTES,), daemon=True)
    t.start()
    logger.info("Sistema de limpieza automática iniciado (GIFs >= %d min)", GIF_MAX_AGE_MINUTES)


# ---------------------------------------------------------------------------
# Procesamiento de GIFs
# ---------------------------------------------------------------------------

_FONT_PATHS = [
    "/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf",  # Linux
    "/System/Library/Fonts/Helvetica.ttc",                    # macOS
    "C:\\Windows\\Fonts\\arial.ttf",                          # Windows
]


def _load_font(font_size: int) -> ImageFont.FreeTypeFont | ImageFont.ImageFont:
    """Carga la primera fuente TrueType disponible en el sistema."""
    for path in _FONT_PATHS:
        try:
            return ImageFont.truetype(path, font_size)
        except OSError:
            continue
    logger.warning("No se encontró fuente TrueType, usando fuente por defecto")
    return ImageFont.load_default()


def add_dates_to_gif(
    gif_url: str,
    dates: list[str],
    output_path: str,
    font_size: int = 14,
    position: str = 'top-left',
    progress_callback: Optional[Callable[[int, str], None]] = None,
) -> str:
    """
    Descarga un GIF de Earth Engine, superpone la fecha en cada frame y lo guarda.

    Args:
        gif_url          : URL del GIF generado por GEE.
        dates            : Lista de fechas 'YYYY-MM-DD', una por frame.
        output_path      : Ruta de salida del GIF procesado.
        font_size        : Tamaño de fuente en píxeles.
        position         : Posición del texto: 'top-left' | 'top-right' |
                           'bottom-left' | 'bottom-right'.
        progress_callback: Función opcional que recibe (porcentaje, mensaje).

    Returns:
        output_path tras guardar el GIF procesado.

    Raises:
        requests.HTTPError: si la descarga del GIF falla.
        Exception: si el procesamiento PIL falla.
    """
    def _report(pct: int, msg: str) -> None:
        if progress_callback:
            progress_callback(pct, msg)

    _report(5, "Descargando GIF desde Earth Engine...")
    logger.info("Descargando GIF desde: %s", gif_url)
    response = requests.get(gif_url, stream=True, timeout=GIF_DOWNLOAD_TIMEOUT_S)
    response.raise_for_status()
    gif_bytes = BytesIO(response.content)

    _report(15, "GIF descargado, cargando frames...")
    original_gif = PILImage.open(gif_bytes)

    _report(20, "Preparando fuente...")
    font        = _load_font(font_size)
    frames      = []
    durations   = []
    total_frames = len(list(ImageSequence.Iterator(original_gif)))

    for i, frame in enumerate(ImageSequence.Iterator(original_gif)):
        progress = 20 + int((i / total_frames) * 70)
        _report(progress, f"Procesando frame {i + 1}/{total_frames}...")

        frame_rgb = frame.convert('RGBA')
        overlay   = PILImage.new('RGBA', frame_rgb.size, (255, 255, 255, 0))
        draw      = ImageDraw.Draw(overlay)

        date_text  = dates[i] if i < len(dates) else "Sin fecha"
        bbox_text  = draw.textbbox((0, 0), date_text, font=font)
        text_w     = bbox_text[2] - bbox_text[0]
        text_h     = bbox_text[3] - bbox_text[1]
        padding    = 8

        if position == 'top-left':
            x, y = padding, padding
        elif position == 'top-right':
            x, y = frame_rgb.width - text_w - padding, padding
        elif position == 'bottom-left':
            x, y = padding, frame_rgb.height - text_h - padding * 2
        elif position == 'bottom-right':
            x = frame_rgb.width  - text_w - padding
            y = frame_rgb.height - text_h - padding * 2
        else:
            x, y = padding, padding

        bg_pad = 4
        draw.rectangle(
            [x - bg_pad, y - bg_pad, x + text_w + bg_pad, y + text_h + bg_pad],
            fill=(0, 0, 0, 180),
        )
        draw.text((x, y), date_text, fill=(255, 255, 255, 255), font=font)

        frame_final = PILImage.alpha_composite(frame_rgb, overlay).convert('RGB')
        frames.append(frame_final)
        durations.append(original_gif.info.get('duration', 500))

    _report(90, "Guardando GIF procesado...")
    logger.info("Guardando GIF procesado en: %s", output_path)
    frames[0].save(
        output_path,
        format='GIF',
        save_all=True,
        append_images=frames[1:],
        duration=durations,
        loop=original_gif.info.get('loop', 0),
        optimize=False,
    )

    _report(100, "¡GIF listo!")
    logger.info("GIF procesado correctamente: %d frames", len(frames))
    return output_path

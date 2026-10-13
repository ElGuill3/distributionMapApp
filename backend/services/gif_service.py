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
from collections.abc import Callable
from io import BytesIO

import requests
from PIL import Image as PILImage
from PIL import ImageDraw, ImageFont, ImageSequence

from backend.config import (
    GIF_CLEANUP_INTERVAL_S,
    GIF_DOWNLOAD_TIMEOUT_S,
    GIF_MAX_AGE_MINUTES,
    GIFS_DIR,
    SSE_MAX_PROGRESS_MESSAGES,
    SSE_MAX_PROGRESS_TASKS,
    SSE_PROGRESS_RETENTION_S,
)

logger = logging.getLogger(__name__)

# ---------------------------------------------------------------------------
# Sistema de progreso SSE
# ---------------------------------------------------------------------------

# Diccionario global: task_id → Queue[dict | None]
progress_queues: dict[str, queue.Queue] = {}

# Lock de proceso que sincroniza registro/consulta/eliminación del registro,
# de forma que el chequeo de identidad + eliminación no corra en paralelo a
# un registro nuevo. Nunca se mantiene durante queue.get() ni yields SSE.
_progress_lock = threading.Lock()
_progress_completed: dict[str, float] = {}


def _expire_completed_progress(now: float) -> None:
    """Remove expired registrations while the registry lock is held."""
    for task_id, completed in list(_progress_completed.items()):
        if now - completed >= SSE_PROGRESS_RETENTION_S:
            progress_queues.pop(task_id, None)
            _progress_completed.pop(task_id, None)


def cleanup_progress_queues() -> None:
    """Sweep completed progress even when no client opens an SSE stream."""
    with _progress_lock:
        _expire_completed_progress(time.monotonic())


def finish_progress_queue(task_id: str, expected_queue: queue.Queue) -> None:
    """Start retention only for the producer that still owns this registration."""
    with _progress_lock:
        if progress_queues.get(task_id) is expected_queue:
            _progress_completed[task_id] = time.monotonic()


class _ProgressQueue(queue.Queue):
    """Bounded latest-progress buffer; producers never wait for an SSE reader."""

    def put(self, item, block=True, timeout=None):
        with self.not_full:
            if self._qsize() >= self.maxsize:
                self._get()
                self.unfinished_tasks -= 1
            self._put(item)
            self.unfinished_tasks += 1
            self.not_empty.notify()


def create_progress_queue(task_id: str) -> queue.Queue:
    """Crea y registra una cola de progreso para la tarea indicada."""
    q = _ProgressQueue(maxsize=SSE_MAX_PROGRESS_MESSAGES)
    with _progress_lock:
        _expire_completed_progress(time.monotonic())
        _progress_completed.pop(task_id, None)
        progress_queues.pop(task_id, None)
        while len(progress_queues) >= SSE_MAX_PROGRESS_TASKS:
            # Prefer completed work; attached readers retain their own queue.
            victim = next(iter(_progress_completed), next(iter(progress_queues)))
            progress_queues.pop(victim, None)
            _progress_completed.pop(victim, None)
        progress_queues[task_id] = q
    return q


def get_progress_queue(task_id: str) -> queue.Queue | None:
    """Devuelve la cola registrada para la tarea, o None si no existe."""
    with _progress_lock:
        _expire_completed_progress(time.monotonic())
        return progress_queues.get(task_id)


def remove_progress_queue(
    task_id: str, expected_queue: queue.Queue | None = None
) -> None:
    """
    Elimina la cola de progreso de una tarea finalizada.

    Con ``expected_queue`` solo elimina el registro si sigue apuntando a esa
    misma cola, de modo que el cierre de un stream antiguo no pueda eliminar
    la cola de una tarea más nueva registrada con el mismo task_id.
    """
    with _progress_lock:
        registered = progress_queues.get(task_id)
        if expected_queue is not None and registered is not expected_queue:
            return
        progress_queues.pop(task_id, None)
        _progress_completed.pop(task_id, None)


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
            cleanup_progress_queues()
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
                logger.info(
                    "Limpieza automática: %d GIFs eliminados (>=%d min)",
                    count,
                    max_age_minutes,
                )
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
    t = threading.Thread(
        target=cleanup_old_gifs, args=(GIF_MAX_AGE_MINUTES,), daemon=True
    )
    t.start()
    logger.info(
        "Sistema de limpieza automática iniciado (GIFs >= %d min)", GIF_MAX_AGE_MINUTES
    )


# ---------------------------------------------------------------------------
# Procesamiento de GIFs
# ---------------------------------------------------------------------------

_FONT_PATHS = [
    # Linux (Fedora, Arch, Debian, Ubuntu)
    "/usr/share/fonts/google-droid-sans-fonts/DroidSans-Bold.ttf",
    "/usr/share/fonts/google-carlito-fonts/Carlito-Bold.ttf",
    "/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf",
    "/usr/share/fonts/dejavu-sans-fonts/DejaVuSans-Bold.ttf",
    "/usr/share/fonts/truetype/liberation/LiberationSans-Bold.ttf",
    "/usr/share/fonts/liberation-sans/LiberationSans-Bold.ttf",
    "/usr/share/fonts/truetype/ubuntu/Ubuntu-B.ttf",
    "/usr/share/fonts/truetype/freefont/FreeSansBold.ttf",
    # macOS
    "/System/Library/Fonts/Helvetica.ttc",
    "/System/Library/Fonts/Supplemental/Arial Bold.ttf",
    "/System/Library/Fonts/Supplemental/Arial.ttf",
    # Windows
    "C:\\Windows\\Fonts\\arialbd.ttf",
    "C:\\Windows\\Fonts\\segoeuib.ttf",
    "C:\\Windows\\Fonts\\calibrib.ttf",
    "C:\\Windows\\Fonts\\arial.ttf",
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
    position: str = "top-left",
    progress_callback: Callable[[int, str], None] | None = None,
) -> str:
    """
    Descarga un GIF de Earth Engine, superpone la fecha en cada frame y lo guarda.

    Args:
        gif_url          : URL del GIF generado por GEE.
        dates            : Lista de fechas 'YYYY-MM-DD', una por frame.
        output_path      : Ruta de salida del GIF procesado.
        font_size        : Tamaño de fuente base (se adaptará dinámicamente si
                           no se cambia).
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

    width, height = original_gif.size

    # Calcular tamaño de fuente y paddings dinámicos según el tamaño del GIF
    # Usamos la dimensión menor para evitar overflow
    base_dim = min(width, height)
    dynamic_font_size = max(10, min(22, int(base_dim * 0.035)))
    bg_pad = max(2, int(dynamic_font_size * 0.25))
    edge_pad = max(4, int(dynamic_font_size * 0.40))

    _report(20, "Preparando fuente...")
    font = _load_font(dynamic_font_size)

    durations = []
    raw_frames = []

    # Extraer todos los frames en formato RGB
    for frame in ImageSequence.Iterator(original_gif):
        raw_frames.append(frame.convert("RGB"))
        durations.append(original_gif.info.get("duration", 500))

    total_frames = len(raw_frames)
    if total_frames == 0:
        raise ValueError("El GIF descargado no contiene frames válidos")

    # --- Anotación y dibujo de fecha ---
    processed_frames = []
    for i, frame_rgb in enumerate(raw_frames):
        progress = 22 + int((i / total_frames) * 70)
        _report(progress, f"Procesando frame {i + 1}/{total_frames}...")

        date_text = dates[i] if i < len(dates) else "Sin fecha"

        # Medir dimensiones del texto
        bbox_text = font.getbbox(date_text)
        text_w = bbox_text[2] - bbox_text[0]
        text_h = bbox_text[3] - bbox_text[1]

        box_w = text_w + 2 * bg_pad
        box_h = text_h + 2 * bg_pad

        # Crear overlay RGBA compacto para el bloque de fecha
        overlay = PILImage.new("RGBA", (box_w, box_h), (0, 0, 0, 180))
        draw = ImageDraw.Draw(overlay)
        # Pintar el texto centrado con respecto al padding interno
        draw.text(
            (bg_pad - bbox_text[0], bg_pad - bbox_text[1]),
            date_text,
            fill=(255, 255, 255, 255),
            font=font,
        )

        # Calcular coordenadas de pegado según posición
        if position == "top-left":
            x, y = edge_pad, edge_pad
        elif position == "top-right":
            x = width - box_w - edge_pad
            y = edge_pad
        elif position == "bottom-left":
            x = edge_pad
            y = height - box_h - edge_pad
        elif position == "bottom-right":
            x = width - box_w - edge_pad
            y = height - box_h - edge_pad
        else:
            x, y = edge_pad, edge_pad

        # Mezclar el overlay con el frame usando pegado local con máscara alpha
        frame_rgb.paste(overlay, (x, y), overlay)

        # Convertir a modo paleta adaptativa sin difuminado (dithering) para
        # mantener colores sólidos
        frame_p = frame_rgb.convert(
            "P", palette=PILImage.Palette.ADAPTIVE, dither=PILImage.Dither.NONE
        )
        processed_frames.append(frame_p)

    _report(92, "Guardando GIF procesado...")
    logger.info("Guardando GIF procesado en: %s", output_path)

    processed_frames[0].save(
        output_path,
        format="GIF",
        save_all=True,
        append_images=processed_frames[1:],
        duration=durations,
        loop=original_gif.info.get("loop", 0),
        optimize=False,
    )

    _report(100, "¡GIF listo!")
    logger.info("GIF procesado correctamente: %d frames", len(processed_frames))
    return output_path

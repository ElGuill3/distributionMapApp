"""
Blueprint 'progress' — endpoint SSE para progreso de generación de GIFs.
"""
import json
import time

from flask import Blueprint, Response, stream_with_context

from config import SSE_TASK_QUEUE_TIMEOUT_S, SSE_WAIT_ATTEMPTS
from services.gif_service import progress_queues, remove_progress_queue
import queue as q_module

progress_bp = Blueprint('progress', __name__)


@progress_bp.get('/api/gif-progress/<task_id>')
def gif_progress(task_id: str) -> Response:
    """
    Endpoint Server-Sent Events que transmite el progreso de una tarea de GIF.

    El cliente abre una conexión EventSource; este endpoint lee de la cola
    correspondiente y envía mensajes JSON con campos 'progress' (0–100 o –1)
    y 'message' (texto descriptivo).

    La conexión se cierra automáticamente cuando el progreso llega a 100 o –1.
    """
    def _generate():
        # Esperar hasta que el endpoint GIF registre su cola de progreso
        task_queue = None
        for _ in range(SSE_WAIT_ATTEMPTS):
            task_queue = progress_queues.get(task_id)
            if task_queue:
                break
            time.sleep(0.1)

        if not task_queue:
            yield f"data: {json.dumps({'progress': -1, 'message': 'Tarea no encontrada'})}\n\n"
            return

        while True:
            try:
                message = task_queue.get(timeout=SSE_TASK_QUEUE_TIMEOUT_S)
                if message is None:
                    break
                yield f"data: {json.dumps(message)}\n\n"
                if message.get('progress') in (100, -1):
                    break
            except q_module.Empty:
                yield f"data: {json.dumps({'progress': 0, 'message': 'timeout'})}\n\n"
                break

        remove_progress_queue(task_id)

    return Response(
        stream_with_context(_generate()),
        mimetype='text/event-stream',
        headers={
            'Cache-Control': 'no-cache',
            'X-Accel-Buffering': 'no',
        },
    )

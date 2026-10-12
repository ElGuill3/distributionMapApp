"""Public SSE progress lifecycle contracts (T4a).

Cubre limpieza de cola en desconexión/cierre normal/fallo, propiedad
old-vs-new con el mismo task_id, uso del timeout configurado y los
mensajes/semánticas públicas que deben preservarse.
"""

import json
from contextlib import ExitStack
from unittest.mock import patch

import pytest

from tests.test_api_query_validation import gif_patches, query

TEMP_URL = "/api/era5-temp-gif-bbox"
SOIL_URL = "/api/era5-soil-gif-bbox"
MISSING = b'data: {"progress": -1, "message": "Tarea no encontrada"}\n\n'


@pytest.fixture
def client(monkeypatch):
    from app import app
    from extensions import limiter

    monkeypatch.setitem(app.config, "TESTING", True)
    monkeypatch.setattr(limiter, "enabled", False)
    return app.test_client()


def generate(client, url, task_id, variable="era5_temp", annotate_side_effect=None):
    with ExitStack() as stack:
        _, gif, series, annotate = gif_patches(stack, variable)
        if annotate_side_effect is not None:
            annotate.side_effect = annotate_side_effect
        response = client.get(url, query_string={**query(), "task_id": task_id})
        counters = (gif.call_count, series.call_count, annotate.call_count)
    assert response.status_code == 200
    return counters


def parse(chunk):
    assert chunk.startswith(b"data: ")
    return json.loads(chunk.decode().removeprefix("data: "))


def sse_events(client, task_id):
    """Consume un stream SSE público acotado y devuelve sus chunks."""
    with patch("backend.routes.progress_routes.SSE_WAIT_ATTEMPTS", 1):
        response = client.get(f"/api/gif-progress/{task_id}", buffered=False)
        assert response.status_code == 200
        assert response.mimetype == "text/event-stream"
        try:
            return [chunk for chunk in response.response]
        finally:
            response.close()


def open_sse(client, task_id):
    """Abre un stream SSE público y devuelve (response, primer chunk)."""
    response = client.get(f"/api/gif-progress/{task_id}", buffered=False)
    assert response.status_code == 200
    assert response.mimetype == "text/event-stream"
    return response, next(iter(response.response))


def test_disconnect_cleans_queue(client):
    task_id = "sse-disconnect"
    generate(client, TEMP_URL, task_id)
    stream, first = open_sse(client, task_id)
    assert parse(first)["progress"] == 0
    stream.close()  # el cliente se desconecta a mitad de stream
    assert sse_events(client, task_id) == [MISSING]


def test_old_stream_completion_keeps_newer_same_id_queue(client):
    task_id = "sse-ownership"
    generate(client, TEMP_URL, task_id)
    stream, first = open_sse(client, task_id)
    assert parse(first)["progress"] == 0
    # El stream viejo termina de leer su cola ya reemplazada: no debe
    # eliminar el registro nuevo del mismo task_id ni mutar nada upstream.
    with ExitStack() as stack:
        _, gif, series, annotate = gif_patches(stack, "era5_soil")
        assert (
            client.get(
                SOIL_URL, query_string={**query(), "task_id": task_id}
            ).status_code
            == 200
        )
        counters = (gif.call_count, series.call_count, annotate.call_count)
        for _ in stream.response:
            pass
        stream.close()
        assert (gif.call_count, series.call_count, annotate.call_count) == counters
    events = sse_events(client, task_id)
    assert events and parse(events[0])["message"] == (
        "Iniciando generación de humedad del suelo..."
    )
    assert events != [MISSING]


def test_duplicate_id_registration_replaces_queue(client):
    task_id = "sse-duplicate"
    generate(client, TEMP_URL, task_id)
    generate(client, SOIL_URL, task_id, variable="era5_soil")
    events = sse_events(client, task_id)
    assert events and parse(events[0])["message"] == (
        "Iniciando generación de humedad del suelo..."
    )


def test_normal_terminal_100_cleans_queue(client):
    task_id = "sse-done-100"

    def report_done(**kwargs):
        kwargs["progress_callback"](100, "¡GIF listo!")

    generate(client, TEMP_URL, task_id, annotate_side_effect=report_done)
    events = sse_events(client, task_id)
    assert [parse(chunk)["progress"] for chunk in events] == [0, 100]
    assert sse_events(client, task_id) == [MISSING]


def test_failure_terminal_minus_one_cleans_queue(client):
    task_id = "sse-done-error"

    def no_data(**kwargs):
        return ""  # build_*_gif_bbox sin datos → error -1

    with ExitStack() as stack:
        _, gif, _, _ = gif_patches(stack, "era5_temp")
        gif.return_value = ""
        response = client.get(TEMP_URL, query_string={**query(), "task_id": task_id})
    assert response.status_code == 400
    events = sse_events(client, task_id)
    assert [parse(chunk)["progress"] for chunk in events] == [0, -1]
    assert parse(events[1])["message"] == "No hay datos de temp"
    assert sse_events(client, task_id) == [MISSING]


def test_missing_task_message_unchanged(client):
    assert sse_events(client, "sse-desconocida") == [MISSING]


def test_queue_get_uses_configured_timeout(client):
    from backend.routes import progress_routes
    from backend.routes.progress_routes import q_module

    task_id = "sse-timeout"
    generate(client, TEMP_URL, task_id)
    real_get = q_module.Queue.get
    timeouts = []
    calls = {"n": 0}

    def recording_get(self, *args, **kwargs):
        timeouts.append(kwargs.get("timeout", args[0] if args else None))
        calls["n"] += 1
        if calls["n"] == 1:
            return real_get(self, *args, **kwargs)
        if calls["n"] == 2:
            raise q_module.Empty
        return None  # señal terminal pública de fin de cola

    with (
        patch.object(q_module.Queue, "get", recording_get),
        patch.object(progress_routes, "SSE_WAIT_ATTEMPTS", 1),
    ):
        events = sse_events(client, task_id)
    assert set(timeouts) == {progress_routes.SSE_TASK_QUEUE_TIMEOUT_S}
    assert any(chunk.startswith(b": keep-alive") for chunk in events)
    assert [
        parse(chunk)["progress"] for chunk in events if chunk != b": keep-alive\n\n"
    ] == [0]
    assert sse_events(client, task_id) == [MISSING]


def test_stream_exception_still_cleans_queue(client):
    from backend.routes import progress_routes

    task_id = "sse-exception"

    def mid_progress(**kwargs):
        kwargs["progress_callback"](50, "mitad")

    generate(client, TEMP_URL, task_id, annotate_side_effect=mid_progress)
    # El primer chunk se calcula dentro de client.get(); la serialización del
    # segundo mensaje ocurre de forma diferida durante la iteración.
    stream = client.get(f"/api/gif-progress/{task_id}", buffered=False)
    assert stream.status_code == 200
    with patch.object(progress_routes.json, "dumps", side_effect=RuntimeError("boom")):
        it = iter(stream.response)
        next(it)  # primer chunk precalculado por client.get()
        with pytest.raises(RuntimeError):
            next(it)
    stream.close()
    assert sse_events(client, task_id) == [MISSING]

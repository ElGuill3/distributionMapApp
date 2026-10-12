"""Public GIF query contracts and rejected-request side effects (T3a)."""

from contextlib import ExitStack
from queue import Empty
from unittest.mock import MagicMock, patch

import pytest

ROUTES = [
    ("era5_temp", "/api/era5-temp-gif-bbox"),
    ("era5_soil", "/api/era5-soil-gif-bbox"),
    ("chirps_precip", "/api/imerg-precip-gif-bbox"),
    ("ndvi", "/api/ndvi-gif-bbox"),
]
INVALID_RATIOS = [
    ("abc", "debe ser un número"),
    ("NaN", "debe ser un número finito"),
    ("Infinity", "debe ser un número finito"),
    ("-Infinity", "debe ser un número finito"),
    ("0", "debe ser mayor que 0"),
    ("-0", "debe ser mayor que 0"),
    ("-1.5", "debe ser mayor que 0"),
]


@pytest.fixture
def client(monkeypatch):
    from app import app
    from extensions import limiter

    monkeypatch.setitem(app.config, "TESTING", True)
    monkeypatch.setattr(limiter, "enabled", False)
    return app.test_client()


def gif_patches(stack, variable):
    directory = MagicMock()
    output = MagicMock()
    output.exists.return_value = False
    directory.__truediv__.return_value = output
    gif = MagicMock(return_value="https://ee.example/test.gif")
    series = MagicMock(return_value=(["2020-07-01"], [0.5]))
    annotate = MagicMock()
    stack.enter_context(
        patch(f"backend.routes.gif_routes.build_{variable}_gif_bbox", gif)
    )
    stack.enter_context(
        patch(f"backend.routes.gif_routes.build_{variable}_timeseries_bbox", series)
    )
    stack.enter_context(patch("backend.routes.gif_routes.add_dates_to_gif", annotate))
    stack.enter_context(patch("backend.routes.gif_routes.GIFS_DIR", directory))
    return directory, gif, series, annotate


def first_progress_event(client, task_id):
    # Limit waiting and make the public queue reader nonblocking if a rejected
    # request incorrectly registered a queue. Never inspect its private registry.
    with (
        patch("backend.routes.progress_routes.SSE_WAIT_ATTEMPTS", 1),
        patch("backend.routes.progress_routes.q_module.Queue.get", side_effect=Empty),
    ):
        response = client.get(f"/api/gif-progress/{task_id}", buffered=False)
        try:
            assert response.status_code == 200
            assert response.mimetype == "text/event-stream"
            return next(iter(response.response))
        finally:
            response.close()


def query():
    return {
        "start": "2020-01-01",
        "end": "2020-12-31",
        "bbox": "[-92.0,17.0,-91.0,18.0]",
    }


@pytest.mark.parametrize("variable,url", ROUTES)
@pytest.mark.parametrize("ratio,message", INVALID_RATIOS)
def test_invalid_ratio_rejected_without_side_effects(
    client, variable, url, ratio, message
):
    task_id = f"ratio-{variable}-{ratio}"
    before = first_progress_event(client, task_id)
    assert before == b'data: {"progress": -1, "message": "Tarea no encontrada"}\n\n'
    with ExitStack() as stack:
        directory, gif, series, annotate = gif_patches(stack, variable)
        response = client.get(
            url, query_string={**query(), "ratio": ratio, "task_id": task_id}
        )
    assert response.status_code == 400
    assert response.get_json() == {"error": f"ratio inválido: {message}"}
    gif.assert_not_called()
    series.assert_not_called()
    annotate.assert_not_called()
    directory.__truediv__.assert_not_called()
    assert first_progress_event(client, task_id) == before


@pytest.mark.parametrize("variable,url", ROUTES)
@pytest.mark.parametrize("ratio,expected", [("1.5", 1.5), (None, None), ("", None)])
def test_valid_absent_and_empty_ratio_preserve_behavior(
    client, variable, url, ratio, expected
):
    parameters = query()
    if ratio is not None:
        parameters["ratio"] = ratio
    with ExitStack() as stack:
        _, gif, series, annotate = gif_patches(stack, variable)
        response = client.get(url, query_string=parameters)
    assert response.status_code == 200
    assert gif.call_count == series.call_count == annotate.call_count == 1
    assert gif.call_args.args[3] == expected
    assert series.call_args.args[:3] == gif.call_args.args[:3]
    assert response.is_json

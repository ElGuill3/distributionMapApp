"""Public bbox contracts and rejected-request side effects (T3b).

Cubre la validación de orden/rango/finitud del bbox en las rutas estándar
de GIF y series temporales (era5-temp, era5-soil, chirps-precip), con
regresiones de comportamiento válido/malformado y el contrato existente
de NDVI preservado con golden literal de la respuesta pública.
"""

from contextlib import ExitStack
from unittest.mock import MagicMock, patch

import pytest

from backend.tests.test_api_query_validation import (
    first_progress_event,
    gif_patches,
    query,
)

GIF_ROUTES = [
    ("era5_temp", "/api/era5-temp-gif-bbox"),
    ("era5_soil", "/api/era5-soil-gif-bbox"),
    ("chirps_precip", "/api/imerg-precip-gif-bbox"),
]
TS_ROUTES = [
    ("era5_temp", "/api/era5-temp-timeseries-bbox"),
    ("era5_soil", "/api/era5-soil-timeseries-bbox"),
    ("chirps_precip", "/api/imerg-precip-timeseries-bbox"),
]
TS_KEYS = {
    "era5_temp": "temp",
    "era5_soil": "soil_pct",
    "chirps_precip": "precip_mm",
}

# (id, bbox crudo, mensaje estable esperado tras el prefijo 'bbox inválido: ')
INVALID_BBOXES = [
    (
        "reversed_lon",
        "[-91.0, 17.0, -92.0, 18.0]",
        "bbox min_lon debe ser menor que max_lon",
    ),
    (
        "reversed_lat",
        "[-92.0, 18.0, -91.0, 17.0]",
        "bbox min_lat debe ser menor que max_lat",
    ),
    (
        "min_eq_max_lon",
        "[-92.0, 17.0, -92.0, 18.0]",
        "bbox min_lon debe ser menor que max_lon",
    ),
    (
        "min_eq_max_lat",
        "[-92.0, 17.0, -91.0, 17.0]",
        "bbox min_lat debe ser menor que max_lat",
    ),
    (
        "lon_out_of_range",
        "[-200.0, 17.0, -91.0, 18.0]",
        "bbox min_lon fuera de rango [-180.0, 180.0]",
    ),
    (
        "lat_out_of_range",
        "[-92.0, 95.0, -91.0, 18.0]",
        "bbox min_lat fuera de rango [-90.0, 90.0]",
    ),
    (
        "max_lat_out_of_range",
        "[-92.0, 17.0, -91.0, 200.0]",
        "bbox max_lat fuera de rango [-90.0, 90.0]",
    ),
    ("nan_lat", "[-92.0, NaN, -91.0, 18.0]", "bbox min_lat debe ser un número finito"),
    (
        "infinite_lon",
        "[Infinity, 17.0, -91.0, 18.0]",
        "bbox min_lon debe ser un número finito",
    ),
    (
        "overflow_lon",
        "[-92.0, 17.0, 1e999, 18.0]",
        "bbox max_lon debe ser un número finito",
    ),
]

MALFORMED_BBOXES = ["not-json", "[1, 2, 3]", '["a", 1, 2, 3]', "{}"]
MALFORMED_MESSAGE = "bbox debe ser un JSON [minLon,minLat,maxLon,maxLat]."

# Goldens literales de la respuesta pública NDVI previa al cambio (baseline
# eb63dfc, pydantic 2.13.4 fijado en uv.lock); no se usa el validador como oráculo.
NDVI_REVERSED_LON_ERROR = (
    "bbox inválido: 1 validation error for BBoxSchema\n"
    "  Value error, min_lon must be less than max_lon [type=value_error, "
    "input_value={'min_lon': -91.0, 'min_l... -92.0, 'max_lat': 18.0}, "
    "input_type=dict]\n"
    "    For further information visit "
    "https://errors.pydantic.dev/2.13/v/value_error"
)
NDVI_OUT_OF_RANGE_ERROR = (
    "bbox inválido: 1 validation error for BBoxSchema\n"
    "min_lon\n"
    "  Input should be greater than or equal to -180 [type=greater_than_equal, "
    "input_value=-200.0, input_type=float]\n"
    "    For further information visit "
    "https://errors.pydantic.dev/2.13/v/greater_than_equal"
)


@pytest.fixture
def client(monkeypatch):
    from app import app
    from extensions import limiter

    monkeypatch.setitem(app.config, "TESTING", True)
    monkeypatch.setattr(limiter, "enabled", False)
    return app.test_client()


def ts_patch(stack, variable):
    series = MagicMock(return_value=(["2020-07-01"], [0.5]))
    stack.enter_context(
        patch(
            f"backend.routes.timeseries_routes.build_{variable}_timeseries_bbox",
            series,
        )
    )
    return series


# ---------------------------------------------------------------------------
# Rutas GIF estándar: rechazo sin efectos secundarios
# ---------------------------------------------------------------------------


@pytest.mark.parametrize("variable,url", GIF_ROUTES)
@pytest.mark.parametrize("name,bbox,message", INVALID_BBOXES)
def test_invalid_bbox_rejected_without_side_effects(
    client, variable, url, name, bbox, message
):
    task_id = f"bbox-{variable}-{name}"
    before = first_progress_event(client, task_id)
    assert before == b'data: {"progress": -1, "message": "Tarea no encontrada"}\n\n'
    with ExitStack() as stack:
        directory, gif, series, annotate = gif_patches(stack, variable)
        response = client.get(
            url, query_string={**query(), "bbox": bbox, "task_id": task_id}
        )
    assert response.status_code == 400
    assert response.get_json() == {"error": f"bbox inválido: {message}"}
    gif.assert_not_called()
    series.assert_not_called()
    annotate.assert_not_called()
    directory.__truediv__.assert_not_called()
    assert first_progress_event(client, task_id) == before


@pytest.mark.parametrize("variable,url", GIF_ROUTES)
@pytest.mark.parametrize(
    "bbox,expected",
    [
        ("[-92.0, 17.0, -91.0, 18.0]", [-92.0, 17.0, -91.0, 18.0]),
        ("[-180.0, -90.0, 180.0, 90.0]", [-180.0, -90.0, 180.0, 90.0]),
    ],
)
def test_valid_and_boundary_bbox_preserve_behavior(
    client, variable, url, bbox, expected
):
    with ExitStack() as stack:
        _, gif, series, annotate = gif_patches(stack, variable)
        response = client.get(url, query_string={**query(), "bbox": bbox})
    assert response.status_code == 200
    assert gif.call_count == series.call_count == annotate.call_count == 1
    body = response.get_json()
    assert body["bbox"] == expected
    assert body["gifUrl"].startswith("/static/gifs/")


@pytest.mark.parametrize("variable,url", GIF_ROUTES)
@pytest.mark.parametrize("bbox", MALFORMED_BBOXES)
def test_malformed_bbox_keeps_existing_message(client, variable, url, bbox):
    with ExitStack() as stack:
        directory, gif, series, annotate = gif_patches(stack, variable)
        response = client.get(url, query_string={**query(), "bbox": bbox})
    assert response.status_code == 400
    assert response.get_json() == {"error": MALFORMED_MESSAGE}
    gif.assert_not_called()
    series.assert_not_called()
    annotate.assert_not_called()
    directory.__truediv__.assert_not_called()


# ---------------------------------------------------------------------------
# Rutas de series temporales: rechazo sin llamar builders
# ---------------------------------------------------------------------------


@pytest.mark.parametrize("variable,url", TS_ROUTES)
@pytest.mark.parametrize("name,bbox,message", INVALID_BBOXES)
def test_timeseries_invalid_bbox_rejected_without_builder_calls(
    client, variable, url, name, bbox, message
):
    with ExitStack() as stack:
        series = ts_patch(stack, variable)
        response = client.get(url, query_string={**query(), "bbox": bbox})
    assert response.status_code == 400
    assert response.get_json() == {"error": f"bbox inválido: {message}"}
    series.assert_not_called()


@pytest.mark.parametrize("variable,url", TS_ROUTES)
@pytest.mark.parametrize(
    "bbox,expected",
    [
        ("[-92.0, 17.0, -91.0, 18.0]", [-92.0, 17.0, -91.0, 18.0]),
        ("[-180.0, -90.0, 180.0, 90.0]", [-180.0, -90.0, 180.0, 90.0]),
    ],
)
def test_timeseries_valid_and_boundary_bbox_preserve_response(
    client, variable, url, bbox, expected
):
    with ExitStack() as stack:
        series = ts_patch(stack, variable)
        response = client.get(url, query_string={**query(), "bbox": bbox})
    assert response.status_code == 200
    assert series.call_count == 1
    assert response.get_json() == {
        "dates": ["2020-07-01"],
        TS_KEYS[variable]: [0.5],
        "bbox": expected,
    }


@pytest.mark.parametrize("variable,url", TS_ROUTES)
@pytest.mark.parametrize("bbox", MALFORMED_BBOXES)
def test_timeseries_malformed_bbox_keeps_existing_message(client, variable, url, bbox):
    with ExitStack() as stack:
        series = ts_patch(stack, variable)
        response = client.get(url, query_string={**query(), "bbox": bbox})
    assert response.status_code == 400
    assert response.get_json() == {"error": MALFORMED_MESSAGE}
    series.assert_not_called()


# ---------------------------------------------------------------------------
# Contrato NDVI existente preservado (golden literal de baseline)
# ---------------------------------------------------------------------------


@pytest.mark.parametrize(
    "bbox,expected",
    [
        ("[-91.0, 17.0, -92.0, 18.0]", NDVI_REVERSED_LON_ERROR),
        ("[-200.0, 17.0, -91.0, 18.0]", NDVI_OUT_OF_RANGE_ERROR),
    ],
)
def test_ndvi_gif_keeps_existing_rejection_payload(client, bbox, expected):
    response = client.get("/api/ndvi-gif-bbox", query_string={**query(), "bbox": bbox})
    assert response.status_code == 400
    assert response.get_json() == {"error": expected}


@pytest.mark.parametrize(
    "bbox", ["[-92.0, 17.0, -91.0, 18.0]", "[-180.0, -90.0, 180.0, 90.0]"]
)
def test_ndvi_gif_valid_bbox_preserves_behavior(client, bbox):
    with ExitStack() as stack:
        _, gif, series, annotate = gif_patches(stack, "ndvi")
        response = client.get(
            "/api/ndvi-gif-bbox", query_string={**query(), "bbox": bbox}
        )
    assert response.status_code == 200
    assert gif.call_count == series.call_count == annotate.call_count == 1

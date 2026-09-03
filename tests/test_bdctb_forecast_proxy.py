"""Focused tests for the bounded BDCTB forecast service proxy."""

import json
from unittest.mock import patch

import pytest
import requests


class FakeUpstream:
    def __init__(self, status_code: int, body: bytes):
        self.status_code = status_code
        self.body = body

    def __enter__(self):
        return self

    def __exit__(self, *_args):
        return None

    def iter_content(self, chunk_size: int):
        for index in range(0, len(self.body), chunk_size):
            yield self.body[index : index + chunk_size]


@pytest.fixture
def client():
    from app import app

    app.config["TESTING"] = True
    return app.test_client()


def test_proxies_success_with_bounded_request_options(client):
    payload = {"schema_version": "bdctb-forecast/v1"}
    with patch(
        "app.requests.get",
        return_value=FakeUpstream(200, json.dumps(payload).encode()),
    ) as get:
        response = client.get("/api/v1/forecasts/bdctb")

    assert response.status_code == 200
    assert response.json == payload
    assert response.headers["Cache-Control"] == "no-store"
    get.assert_called_once_with(
        "http://127.0.0.1:8765/api/v1/forecasts/bdctb",
        headers={"Accept": "application/json"},
        timeout=(2, 5),
        allow_redirects=False,
        stream=True,
    )


def test_preserves_forecast_unavailable_response(client):
    payload = {"error": {"code": "forecast_unavailable"}}
    with patch(
        "app.requests.get",
        return_value=FakeUpstream(503, json.dumps(payload).encode()),
    ):
        response = client.get("/api/v1/forecasts/bdctb")

    assert response.status_code == 503
    assert response.json == payload


def test_rejects_oversized_response(client):
    with patch(
        "app.requests.get", return_value=FakeUpstream(200, b"x" * (64 * 1024 + 1))
    ):
        response = client.get("/api/v1/forecasts/bdctb")

    assert response.status_code == 502
    assert response.json == {"error": "Forecast response is too large."}


def test_maps_timeout_without_exposing_upstream_details(client):
    with patch("app.requests.get", side_effect=requests.Timeout("private detail")):
        response = client.get("/api/v1/forecasts/bdctb")

    assert response.status_code == 504
    assert response.json == {"error": "Forecast service timed out."}


def test_maps_connection_failure_without_exposing_upstream_details(client):
    with patch(
        "app.requests.get", side_effect=requests.ConnectionError("private detail")
    ):
        response = client.get("/api/v1/forecasts/bdctb")

    assert response.status_code == 502
    assert response.json == {"error": "Forecast service is unavailable."}


def test_maps_unexpected_upstream_status_without_exposing_body(client):
    with patch(
        "app.requests.get", return_value=FakeUpstream(500, b"private upstream body")
    ):
        response = client.get("/api/v1/forecasts/bdctb")

    assert response.status_code == 502
    assert response.json == {"error": "Forecast service returned an error."}


def test_rejects_request_61_before_contacting_upstream(client):
    from extensions import limiter

    limiter.reset()
    try:
        with patch(
            "app.requests.get",
            return_value=FakeUpstream(200, b'{"schema_version":"bdctb-forecast/v1"}'),
        ) as get:
            responses = [client.get("/api/v1/forecasts/bdctb") for _ in range(61)]

        assert [response.status_code for response in responses[:60]] == [200] * 60
        assert responses[60].status_code == 429
        assert get.call_count == 60
    finally:
        limiter.reset()

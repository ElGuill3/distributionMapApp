"""Public BDCTB route: valid v2 envelopes, cache fallback and quota protection."""

from unittest.mock import Mock

import pytest
import requests

from backend.forecast_feed import UNAVAILABLE, ForecastFeed
from backend.tests.test_forecast_feed import Reply, payload


@pytest.fixture
def setup_feed(tmp_path, monkeypatch):
    import backend.app as module

    http = Mock()
    monkeypatch.setattr("requests.get", http.get)
    service = ForecastFeed(
        "https://example.test/latest.json", tmp_path / "latest.json", http=http
    )
    monkeypatch.setattr(module, "forecast_feed", service, raising=False)
    return module.app.test_client(), http


def test_public_network_and_cache_shape(setup_feed):
    client, http = setup_feed
    http.get.return_value = Reply(payload())
    response = client.get("/api/v1/forecasts/bdctb")
    assert response.status_code == 200
    assert response.json["forecast"] == payload()
    assert response.json["source"] == "network"
    assert response.json["updating"] is False
    assert response.headers["Cache-Control"] == "no-store"
    http.get.side_effect = requests.Timeout("private detail")
    cached = client.get("/api/v1/forecasts/bdctb")
    assert cached.status_code == 200
    assert cached.json == {**response.json, "source": "cache"}


def test_no_valid_copy_returns_safe_spanish_503(setup_feed):
    client, http = setup_feed
    http.get.side_effect = requests.ConnectionError("private detail")
    response = client.get("/api/v1/forecasts/bdctb")
    assert response.status_code == 503
    assert response.json == {"error": UNAVAILABLE}
    assert response.headers["Cache-Control"] == "no-store"


def test_rejects_request_61_before_contacting_upstream(setup_feed, monkeypatch):
    from backend.extensions import limiter

    client, http = setup_feed
    http.get.return_value = Reply(payload())
    monkeypatch.setattr(limiter, "enabled", True)
    limiter.reset()
    try:
        responses = [client.get("/api/v1/forecasts/bdctb") for _ in range(61)]
        assert [r.status_code for r in responses[:60]] == [200] * 60
        assert responses[60].status_code == 429
        assert http.get.call_count == 60
    finally:
        limiter.reset()

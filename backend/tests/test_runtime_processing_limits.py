"""Runtime processing limits reach the client as server-owned template JSON."""

import json
import re

import pytest

from backend.config import MAX_SPAN_DEG, MAX_SPAN_DEG_S2, MAX_YEARS_RANGE


@pytest.fixture
def client():
    """Cliente de test Flask con app real (conftest desactiva boot/rate)."""
    from backend.app import app

    app.config["TESTING"] = True
    return app.test_client()


LIMITS_SCRIPT = re.compile(
    r'<script id="runtime-limits" type="application/json">(.*?)</script>',
    re.DOTALL,
)
MODULE_SCRIPT = '<script type="module" src="/static/main.js'
EXPECTED_KEYS = {"MAX_SPAN_DEG", "MAX_YEARS_RANGE", "MAX_SPAN_DEG_S2"}


def served_limits(client):
    response = client.get("/")
    assert response.status_code == 200
    html = response.get_data(as_text=True)
    match = LIMITS_SCRIPT.search(html)
    assert match, "runtime limits JSON script missing from index"
    return html, json.loads(match.group(1))


def test_index_serves_exact_runtime_limits_json(client):
    _, limits = served_limits(client)
    assert set(limits) == EXPECTED_KEYS
    assert limits == {
        "MAX_SPAN_DEG": MAX_SPAN_DEG,
        "MAX_YEARS_RANGE": MAX_YEARS_RANGE,
        "MAX_SPAN_DEG_S2": MAX_SPAN_DEG_S2,
    }
    assert all(
        isinstance(value, (int, float)) and value > 0 for value in limits.values()
    )


def test_runtime_limits_script_precedes_deferred_module(client):
    html, _ = served_limits(client)
    assert html.index('id="runtime-limits"') < html.index(MODULE_SCRIPT)


def test_server_context_overrides_client_limit_values(client, monkeypatch):
    from backend import config

    monkeypatch.setattr(config, "MAX_SPAN_DEG", 5.5)
    monkeypatch.setattr(config, "MAX_YEARS_RANGE", 2.25)
    monkeypatch.setattr(config, "MAX_SPAN_DEG_S2", 1.0)
    _, limits = served_limits(client)
    assert limits == {
        "MAX_SPAN_DEG": 5.5,
        "MAX_YEARS_RANGE": 2.25,
        "MAX_SPAN_DEG_S2": 1.0,
    }

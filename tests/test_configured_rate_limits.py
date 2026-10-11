"""Configured quotas through public HTTP endpoints in private cold processes."""

import json
import os
import subprocess
import sys

import pytest

from tests.test_app_startup import snapshot as _snapshot


@pytest.fixture
def snapshot(tmp_path):
    return _snapshot.__wrapped__(tmp_path)


CASES = [
    ("gif", "/api/ndvi-gif-bbox", 30),
    ("gif", "/api/era5-temp-gif-bbox", 30),
    ("gif", "/api/era5-soil-gif-bbox", 30),
    ("gif", "/api/imerg-precip-gif-bbox", 30),
    ("timeseries", "/api/ndvi-timeseries-bbox", 60),
    ("timeseries", "/api/era5-temp-timeseries-bbox", 60),
    ("timeseries", "/api/era5-soil-timeseries-bbox", 60),
    ("timeseries", "/api/imerg-precip-timeseries-bbox", 60),
    ("export", "/api/export/bundle", 10),
    ("flood", "/api/flood-risk-municipio", 60),
    ("flood", "/api/flood-detection", 60),
    ("flood_stats", "/api/flood-stats", 30),
    ("station", "/api/local-stations", 60),
    ("station", "/api/local-station-level-range", 60),
    ("forecast", "/api/v1/forecasts/bdctb", 60),
]
CATEGORIES = sorted({case[0] for case in CASES})
PROBE = r"""
import json, os, runpy, warnings
from unittest.mock import patch
warnings.simplefilter("ignore", UserWarning)
next(runpy.run_path("tests/conftest.py")["mock_modules"].__wrapped__())
import app as module
import requests
module.app.config["INITIALIZE_RUNTIME"] = False
path = os.environ["LIMIT_PATH"]
count = int(os.environ["LIMIT_REQUESTS"])
with patch("requests.get",
           side_effect=requests.RequestException("synthetic")) as provider:
    with module.app.test_client() as client:
        responses = [(client.post(path, json={}) if path == "/api/export/bundle"
                      else client.get(path)) for _ in range(count)]
    print(json.dumps({"statuses": [r.status_code for r in responses],
        "bodies": [r.get_json() for r in responses],
        "cache": [r.headers.get("Cache-Control") for r in responses],
        "provider_calls": provider.call_count}))
"""


def environment():
    env = dict(os.environ)
    for category in CATEGORIES:
        env.pop("RATE_LIMIT_" + category.upper(), None)
    env.update(
        {
            "RATE_LIMIT_ENABLED": "true",
            "_DISTRIBUTIONMAPAPP_RUNTIME_STARTUP": "0",
            "_DISTRIBUTIONMAPAPP_DEPENDENCY_PREFLIGHT": "0",
        }
    )
    return env


def http_probe(snapshot, category, path, cap, mode):
    env = environment()
    env.update(LIMIT_PATH=path, LIMIT_REQUESTS=str(cap + 1 if mode == "default" else 2))
    if mode != "default":
        env["RATE_LIMIT_" + category.upper()] = "1/minute"
    if mode == "disabled":
        env["RATE_LIMIT_ENABLED"] = "false"
    result = subprocess.run(
        [sys.executable, "-c", PROBE],
        cwd=snapshot,
        env=env,
        capture_output=True,
        text=True,
        timeout=15,
        check=False,
    )
    assert result.returncode == 0, result.stderr
    assert result.stderr == ""
    assert (snapshot / "static/gifs/old.gif").read_text() == "synthetic-gif"
    return json.loads(result.stdout)


@pytest.mark.parametrize("category,path,cap", CASES)
@pytest.mark.parametrize("mode", ["configured", "default", "disabled"])
def test_http_quotas_and_existing_default_disable_contract(
    snapshot, category, path, cap, mode
):
    observed = http_probe(snapshot, category, path, cap, mode)
    assert observed["statuses"][0] in (200, 400, 502)
    if mode == "disabled":
        assert observed["statuses"] == [observed["statuses"][0]] * 2
        assert observed["bodies"] == [observed["bodies"][0]] * 2
        expected_calls = 2 if category == "forecast" else 0
    else:
        count = cap if mode == "default" else 1
        assert observed["statuses"] == [observed["statuses"][0]] * count + [429]
        assert observed["bodies"][-1] == {
            "error": f"Rate limit exceeded: {count} per 1 minute."
        }
        assert observed["cache"][-1] == "no-store"
        expected_calls = count if category == "forecast" else 0
    assert observed["provider_calls"] == expected_calls


@pytest.mark.parametrize("category", CATEGORIES)
@pytest.mark.parametrize("value", ["", "0/minute", "-1/minute", "bad-sensitive-token"])
def test_invalid_quota_fails_closed_without_echoing_value(snapshot, category, value):
    env = environment()
    key = "RATE_LIMIT_" + category.upper()
    env[key] = value
    result = subprocess.run(
        [sys.executable, "-c", "import config"],
        cwd=snapshot,
        env=env,
        capture_output=True,
        text=True,
        timeout=15,
        check=False,
    )
    assert result.returncode == 1
    assert result.stdout == ""
    assert result.stderr.endswith(
        f"ValueError: {key} must specify positive request rates.\n"
    )
    assert "bad-sensitive-token" not in result.stderr
    assert (snapshot / "static/gifs/old.gif").read_text() == "synthetic-gif"

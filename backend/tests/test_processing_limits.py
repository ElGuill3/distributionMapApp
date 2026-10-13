"""Processing quotas fail closed before any application runtime starts."""

import json
import os
import subprocess
import sys

import pytest

from backend.tests.test_app_startup import snapshot as _snapshot


@pytest.fixture
def snapshot(tmp_path):
    return _snapshot.__wrapped__(tmp_path)


DEFAULTS = {"MAX_SPAN_DEG": 8.0, "MAX_YEARS_RANGE": 10.0, "MAX_SPAN_DEG_S2": 4.0}
IMPORT = (
    "from backend import config; import json; print(json.dumps({k: getattr(config,k) for k in "
    + repr(list(DEFAULTS))
    + "}))"
)


def probe(snapshot, overrides):
    env = dict(os.environ)
    for key in DEFAULTS:
        env.pop(key, None)
    env.update(overrides)
    result = subprocess.run(
        [sys.executable, "-c", IMPORT],
        cwd=snapshot,
        env=env,
        capture_output=True,
        text=True,
        check=False,
        timeout=10,
    )
    assert (snapshot / "frontend/static/gifs/old.gif").read_text() == "synthetic-gif"
    return result


@pytest.mark.parametrize("key", DEFAULTS)
@pytest.mark.parametrize(
    "value", ["nan", "inf", "-inf", "0", "-1", "", "bad-sensitive-token"]
)
def test_invalid_processing_limit_aborts_without_value_echo(snapshot, key, value):
    result = probe(snapshot, {key: value})
    assert result.returncode == 1
    assert result.stdout == ""
    assert result.stderr.endswith(
        f"ValueError: {key} must be a finite number greater than zero.\n"
    )
    assert "bad-sensitive-token" not in result.stderr


def test_declared_processing_defaults_are_unchanged(snapshot):
    result = probe(snapshot, {})
    assert result.returncode == 0
    assert result.stderr == ""
    assert result.stdout == json.dumps(DEFAULTS) + "\n"


@pytest.mark.parametrize("key", DEFAULTS)
def test_positive_fractional_processing_limit_is_preserved(snapshot, key):
    result = probe(snapshot, {key: "1.5"})
    assert result.returncode == 0
    assert result.stderr == ""
    assert result.stdout == json.dumps({**DEFAULTS, key: 1.5}) + "\n"

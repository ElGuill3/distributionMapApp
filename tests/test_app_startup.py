"""Public startup contracts with private files and mocked external effects."""

import json
import os
import shutil
import subprocess
import sys
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parents[1]
PROBE = r"""
import json, os, runpy, time, warnings
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path
from unittest.mock import patch
warnings.simplefilter("ignore", UserWarning)
fixtures = runpy.run_path("tests/conftest.py")
next(fixtures["mock_modules"].__wrapped__())
import config
mode = os.environ["STARTUP_PROBE"]
with patch("config.prepare_runtime_directories") as directories, \
     patch("ee.Initialize") as earth_engine, \
     patch("backend.services.gif_service.start_cleanup_daemon") as cleanup, \
     patch("logging.basicConfig") as logging_setup:
    if mode == "startup_failure":
        earth_engine.side_effect = RuntimeError("synthetic EE failure")
    import app as module
    failure = None
    statuses = []
    if mode in ("explicit", "concurrent", "failure"):
        if mode == "failure":
            earth_engine.side_effect = RuntimeError("synthetic EE failure")
            try:
                module.initialize_runtime()
            except RuntimeError as error:
                failure = str(error)
        elif mode == "concurrent":
            earth_engine.side_effect = lambda **kw: time.sleep(0.03)
            with ThreadPoolExecutor(max_workers=8) as pool:
                list(pool.map(lambda _: module.initialize_runtime(), range(16)))
        else:
            module.initialize_runtime()
            module.initialize_runtime()
    if mode in ("request", "disabled", "preflight"):
        module.app.config["INITIALIZE_RUNTIME"] = mode != "disabled"
        with module.app.test_client() as client:
            statuses = [client.get("/api/docs").status_code for _ in range(2)]
    print(json.dumps({"directories": directories.call_count,
        "ee": earth_engine.call_count, "cleanup": cleanup.call_count,
        "logging": logging_setup.call_count, "failure": failure,
        "statuses": statuses, "gif": Path("static/gifs/old.gif").read_text()}))
"""


@pytest.fixture
def snapshot(tmp_path):
    for filename in ("app.py", "config.py", "extensions.py"):
        shutil.copy2(ROOT / filename, tmp_path / filename)
    for directory in ("backend", "routes"):
        for source in (ROOT / directory).rglob("*.py"):
            target = tmp_path / source.relative_to(ROOT)
            target.parent.mkdir(parents=True, exist_ok=True)
            shutil.copy2(source, target)
    for relative in ("tests/conftest.py", "templates/scalar.html"):
        target = tmp_path / relative
        target.parent.mkdir(parents=True, exist_ok=True)
        shutil.copy2(ROOT / relative, target)
    marker = tmp_path / "static/gifs/old.gif"
    marker.parent.mkdir(parents=True)
    marker.write_text("synthetic-gif", encoding="utf-8")
    os.utime(marker, (1, 1))
    return tmp_path


def probe(snapshot, mode, *, startup=False, preflight=False):
    environment = dict(os.environ)
    environment.update(
        {
            "STARTUP_PROBE": mode,
            "_DISTRIBUTIONMAPAPP_RUNTIME_STARTUP": "1" if startup else "0",
            "_DISTRIBUTIONMAPAPP_DEPENDENCY_PREFLIGHT": "1" if preflight else "0",
        }
    )
    result = subprocess.run(
        [sys.executable, "-c", PROBE],
        cwd=snapshot,
        env=environment,
        capture_output=True,
        text=True,
        timeout=15,
        check=False,
    )
    assert result.returncode == 0, result.stderr
    assert result.stderr == ""
    observed = json.loads(result.stdout)
    assert observed["gif"] == "synthetic-gif"
    return observed


def test_import_does_not_initialize_external_runtime(snapshot):
    observed = probe(snapshot, "import")
    assert observed == {
        "directories": 0,
        "ee": 0,
        "cleanup": 0,
        "logging": 0,
        "failure": None,
        "statuses": [],
        "gif": "synthetic-gif",
    }


@pytest.mark.parametrize("mode", ["explicit", "concurrent", "request"])
def test_public_runtime_initializes_once(snapshot, mode):
    observed = probe(snapshot, mode)
    assert [observed[key] for key in ("directories", "ee", "cleanup", "logging")] == [
        1,
        1,
        1,
        1,
    ]
    assert observed["failure"] is None
    assert observed["statuses"] == ([200, 200] if mode == "request" else [])


@pytest.mark.parametrize("preflight", [False, True])
def test_explicit_test_and_preflight_modes_do_not_start_runtime(snapshot, preflight):
    observed = probe(
        snapshot,
        "preflight" if preflight else "disabled",
        startup=preflight,
        preflight=preflight,
    )
    assert [observed[key] for key in ("directories", "ee", "cleanup", "logging")] == [
        0,
        0,
        0,
        0,
    ]
    assert observed["statuses"] == [200, 200]
    assert observed["failure"] is None


def test_launcher_flag_initializes_before_serving(snapshot):
    observed = probe(snapshot, "import", startup=True)
    assert [observed[key] for key in ("directories", "ee", "cleanup", "logging")] == [
        1,
        1,
        1,
        1,
    ]
    assert observed["statuses"] == []


def test_launcher_startup_failure_exits_before_serving(snapshot):
    environment = dict(os.environ)
    environment.update(
        {
            "STARTUP_PROBE": "startup_failure",
            "_DISTRIBUTIONMAPAPP_RUNTIME_STARTUP": "1",
            "_DISTRIBUTIONMAPAPP_DEPENDENCY_PREFLIGHT": "0",
        }
    )
    result = subprocess.run(
        [sys.executable, "-c", PROBE],
        cwd=snapshot,
        env=environment,
        capture_output=True,
        text=True,
        timeout=15,
        check=False,
    )
    assert result.returncode == 1
    assert result.stdout == ""
    assert result.stderr.endswith("RuntimeError: synthetic EE failure\n")
    assert (snapshot / "static/gifs/old.gif").read_text() == "synthetic-gif"


def test_ee_failure_does_not_start_cleanup(snapshot):
    observed = probe(snapshot, "failure")
    assert observed["failure"] == "synthetic EE failure"
    assert [observed[key] for key in ("directories", "ee", "cleanup", "logging")] == [
        1,
        1,
        0,
        1,
    ]

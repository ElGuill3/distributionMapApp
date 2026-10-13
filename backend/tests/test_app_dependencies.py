"""The web app runs without the offline flood-model dependencies."""

import subprocess
import sys
import tomllib
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]

# Import the real app in a cold process with rasterio and matplotlib made
# unimportable; Earth Engine is mocked the same way the test suite does.
PROBE = r"""
import runpy, sys, warnings
warnings.simplefilter("ignore")
next(runpy.run_path("backend/tests/conftest.py")["mock_modules"].__wrapped__())
for name in ("rasterio", "matplotlib", "matplotlib.cm", "matplotlib.colors"):
    sys.modules[name] = None
import backend.app as module
client = module.app.test_client()
module.app.config["INITIALIZE_RUNTIME"] = False
assert client.get("/api/flood-risk/metadata").status_code == 200
print("ok")
"""


def _pyproject():
    return tomllib.loads((ROOT / "pyproject.toml").read_text(encoding="utf-8"))


def test_app_dependencies_exclude_offline_raster_stack():
    deps = [
        d.split(">")[0].split("=")[0].strip().lower()
        for d in _pyproject()["project"]["dependencies"]
    ]
    assert "rasterio" not in deps
    assert "matplotlib" not in deps


def test_floodmodel_group_provides_rasterio():
    group = [
        d.split(">")[0].strip().lower()
        for d in _pyproject()["dependency-groups"]["floodmodel"]
    ]
    assert "rasterio" in group


def test_app_serves_flood_risk_without_rasterio_or_matplotlib():
    result = subprocess.run(
        [sys.executable, "-c", PROBE],
        cwd=ROOT,
        capture_output=True,
        text=True,
        timeout=120,
    )
    assert result.returncode == 0, result.stderr[-2000:]
    assert result.stdout.strip().endswith("ok")

"""Public import boundaries for the organized backend packages."""

import json
import os
import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]


def test_scraper_package_imports_preserve_runtime_paths(tmp_path):
    """Cold imports must not execute a scheduler, scraper or app provider."""
    script = r"""
import json, sys
from pathlib import Path
import backend
from backend.scrapers.base import BaseScraper
from backend.scrapers.conagua import ConaguaScraper
from backend.scrapers.smn import SmnWeatherScraper
from backend.scripts.bootstrap_stations import ConaguaScraper as bootstrap_scraper
from backend import config
assert bootstrap_scraper is ConaguaScraper
assert issubclass(ConaguaScraper, BaseScraper)
assert issubclass(SmnWeatherScraper, BaseScraper)
assert not any(n in ("app", "backend.app", "ee", "scrapers") for n in sys.modules)
assert Path(config.BASE_DIR) == Path(sys.argv[1])
root = Path(sys.argv[1])
assert Path(config.FLOOD_RISK_DIR) == root / "backend" / "data" / "flood_risk"
assert ConaguaScraper("hidros", ["bdctb"]).output_dir == (
    root / "backend" / "data" / "stations" / "hidros"
)
assert Path(config.STATIC_DIR) == Path(sys.argv[1]) / "frontend" / "static"
assert list(Path(sys.argv[1]).iterdir()) == []
print(json.dumps({"base": str(config.BASE_DIR), "package": backend.__name__}))
"""
    env = {
        **os.environ,
        "BASE_DIR_OVERRIDE": str(tmp_path),
        "HOME": str(tmp_path),
        "TMPDIR": str(tmp_path),
        "PYTHONDONTWRITEBYTECODE": "1",
        "PYTHON_DOTENV_DISABLED": "1",
    }
    result = subprocess.run(
        [sys.executable, "-c", script, str(tmp_path)],
        cwd=ROOT,
        env=env,
        capture_output=True,
        text=True,
        timeout=20,
    )
    assert result.returncode == 0, result.stderr
    assert result.stderr == ""
    assert (
        result.stdout
        == json.dumps({"base": str(tmp_path), "package": "backend"}) + "\n"
    )
    assert list(tmp_path.iterdir()) == []

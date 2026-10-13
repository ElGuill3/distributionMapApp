"""The relocated app, config and extensions modules load once from backend/."""

import os
import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]

PROBE = """
import sys
import backend.app as app_module
import backend.config as config_module
import backend.extensions as extensions_module
import backend.routes.gif_routes as gif_routes
assert app_module.config is config_module
assert not {"config", "app", "extensions", "app_preflight"} & set(sys.modules)
assert gif_routes.limiter is extensions_module.limiter is app_module.limiter
print(config_module.BASE_DIR)
"""


def test_backend_modules_are_single_instances_anchored_at_repo_root(tmp_path):
    probe = tmp_path / "probe.py"
    probe.write_text(PROBE, encoding="utf-8")
    env = {
        **os.environ,
        "HOME": str(tmp_path),
        "PYTHONPATH": str(ROOT),
        "PYTHONDONTWRITEBYTECODE": "1",
        "PYTHON_DOTENV_DISABLED": "1",
    }
    env.pop("BASE_DIR_OVERRIDE", None)

    result = subprocess.run(
        [sys.executable, str(probe)],
        cwd=tmp_path,
        env=env,
        capture_output=True,
        text=True,
        timeout=60,
    )

    assert result.returncode == 0, result.stderr
    assert result.stdout == f"{ROOT}\n"

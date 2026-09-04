"""Validate the real Flask application import boundary without runtime actions."""

from __future__ import annotations

import importlib
import os
import sys
from pathlib import Path

from dotenv import load_dotenv

PREFLIGHT_ENV = "_DISTRIBUTIONMAPAPP_DEPENDENCY_PREFLIGHT"


class AppPreflightError(RuntimeError):
    """A sanitized application preflight failure."""


def verify_app_runtime() -> None:
    """Import the application and validate local Earth Engine authorization."""
    load_dotenv()
    project = os.getenv("GEE_PROJECT", "").strip()
    if not project or project == "inundaciones-proyecto":
        raise AppPreflightError("Earth Engine project is not configured")

    try:
        ee = importlib.import_module("ee")
        persistent = Path(ee.oauth.get_credentials_path()).expanduser()
    except Exception as exc:
        raise AppPreflightError("Earth Engine dependency is unavailable") from exc

    application = os.getenv("GOOGLE_APPLICATION_CREDENTIALS", "").strip()
    application_path = Path(application).expanduser() if application else None
    gcloud_adc = Path.home() / ".config/gcloud/application_default_credentials.json"
    if (
        not persistent.is_file()
        and not (application_path and application_path.is_file())
        and not gcloud_adc.is_file()
    ):
        raise AppPreflightError("Earth Engine authorization is unavailable")

    previous = os.environ.get(PREFLIGHT_ENV)
    os.environ[PREFLIGHT_ENV] = "1"
    try:
        importlib.import_module("app")
    except Exception as exc:
        raise AppPreflightError(
            "application dependency boundary is unavailable"
        ) from exc
    finally:
        if previous is None:
            os.environ.pop(PREFLIGHT_ENV, None)
        else:
            os.environ[PREFLIGHT_ENV] = previous


def main() -> int:
    try:
        verify_app_runtime()
    except Exception:
        print("Application preflight failed safely.", file=sys.stderr)
        return 2
    return 0


if __name__ == "__main__":
    raise SystemExit(main())

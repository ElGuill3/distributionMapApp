"""
conftest.py — fixtures globales para todos los tests.
"""

import sys
from unittest.mock import MagicMock

import pytest


# ---------------------------------------------------------------------------
# Mock de módulos no disponibles en entorno de test local
# ---------------------------------------------------------------------------
@pytest.fixture(scope="session", autouse=True)
def mock_modules():
    """
    Reemplaza módulos no disponibles por MagicMock ANTES de que cualquier
    test importe el módulo app o cualquier módulo que dependa de ellos.
    """
    # Mock de Google Earth Engine
    mock_ee_module = MagicMock()
    mock_ee_module.Initialize = MagicMock()
    mock_ee_module.Image = MagicMock()
    mock_ee_module.FeatureCollection = MagicMock()
    mock_ee_module.Geometry = MagicMock()
    mock_ee_module.Number = MagicMock()
    mock_ee_module.Date = MagicMock()
    mock_ee_module.ReduceRegionProperties = MagicMock()
    mock_ee_module.Filter = MagicMock()
    mock_ee_module.DateRange = MagicMock()
    mock_ee_module.Algorithm = MagicMock()
    sys.modules["ee"] = mock_ee_module

    # Mock de rasterio (solo lo usa el pipeline offline backend.floodmodel)
    mock_rasterio = MagicMock()
    sys.modules["rasterio"] = mock_rasterio

    # Mock de pandas
    mock_pandas = MagicMock()
    sys.modules["pandas"] = mock_pandas
    sys.modules["pd"] = mock_pandas

    yield
    # No cleanup needed — session scope


@pytest.fixture(autouse=True)
def disable_external_runtime(monkeypatch, mock_modules):
    """Isolate API behavior tests from runtime effects and shared quota counters."""
    from backend.app import app
    from backend.extensions import limiter

    monkeypatch.setitem(app.config, "INITIALIZE_RUNTIME", False)
    # Quota enforcement is exercised in private cold-process HTTP tests.
    monkeypatch.setattr(limiter, "enabled", False)

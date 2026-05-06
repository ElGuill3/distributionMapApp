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

    # Mock de rasterio (usado por gee.flood_risk)
    mock_rasterio = MagicMock()
    sys.modules["rasterio"] = mock_rasterio

    # Mock de matplotlib
    mock_matplotlib = MagicMock()
    mock_matplotlib.cm = MagicMock()
    mock_matplotlib.colors = MagicMock()
    mock_matplotlib.colors.LinearSegmentedColormap = MagicMock
    mock_matplotlib.colors.Normalize = MagicMock
    sys.modules["matplotlib"] = mock_matplotlib
    sys.modules["matplotlib.cm"] = mock_matplotlib.cm
    sys.modules["matplotlib.colors"] = mock_matplotlib.colors

    # Mock de PIL
    mock_pil = MagicMock()
    mock_pil.Image = MagicMock()
    sys.modules["PIL"] = mock_pil
    sys.modules["PIL.Image"] = mock_pil.Image

    # Mock de pandas
    mock_pandas = MagicMock()
    sys.modules["pandas"] = mock_pandas
    sys.modules["pd"] = mock_pandas

    yield
    # No cleanup needed — session scope

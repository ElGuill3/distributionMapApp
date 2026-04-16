"""
conftest.py — fixtures globales para todos los tests.
"""

import sys
from unittest.mock import MagicMock

import pytest


# ---------------------------------------------------------------------------
# Mock de Google Earth Engine (no disponible en entorno de test local)
# ---------------------------------------------------------------------------
@pytest.fixture(scope="session", autouse=True)
def mock_ee():
    """
    Reemplaza `ee` por un MagicMock en sys.modules ANTES de que cualquier
    test importe el módulo app o cualquier módulo que dependa de ee.
    """
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
    yield
    # No cleanup needed — session scope

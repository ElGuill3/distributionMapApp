"""
Tests de API para detección de inundaciones y cálculo de estadísticas.
"""

import json
from unittest.mock import MagicMock, patch

import pytest

SMALL_BBOX_URL = "[-92.0,17.0,-91.0,18.0]"


@pytest.fixture
def client():
    """Cliente de test Flask con app real."""
    from app import app
    app.config["TESTING"] = True
    return app.test_client()


def test_flood_detection_success(client):
    """Verifica que el endpoint de detección de inundación funcione con parámetros válidos."""
    mock_res = {
        "flood_layer_url": "https://earthengine.googleapis.com/v1/projects/earthengine-legacy/maps/foo/tiles/{z}/{x}/{y}",
        "sat_layer_url": "https://earthengine.googleapis.com/v1/projects/earthengine-legacy/maps/bar/tiles/{z}/{x}/{y}",
        "threshold": -15.5
    }

    with patch("gee.water.detect_floods_bbox", return_value=mock_res) as mock_detect:
        response = client.get(
            f"/api/flood-detection?start=2020-01-01&end=2020-12-31&bbox={SMALL_BBOX_URL}&satellite=sentinel1&auto=true"
        )
        assert response.status_code == 200
        data = response.get_json()
        assert data["threshold"] == -15.5
        assert "flood_layer_url" in data
        mock_detect.assert_called_once_with(
            start="2020-01-01",
            end="2020-12-31",
            bbox=[-92.0, 17.0, -91.0, 18.0],
            satellite="sentinel1",
            use_auto_threshold=True,
            threshold=-18.0
        )


def test_flood_detection_no_images(client):
    """Verifica que retorne 404 si no hay imágenes en el rango o zona."""
    with patch("gee.water.detect_floods_bbox", return_value=None):
        response = client.get(
            f"/api/flood-detection?start=2020-01-01&end=2020-12-31&bbox={SMALL_BBOX_URL}&satellite=sentinel1"
        )
        assert response.status_code == 404
        assert "No se encontraron imágenes" in response.get_json()["error"]


def test_flood_detection_invalid_params(client):
    """Verifica la validación de parámetros en el endpoint de detección."""
    # Bbox inválido
    response = client.get(
        "/api/flood-detection?start=2020-01-01&end=2020-12-31&bbox=invalid"
    )
    assert response.status_code == 400
    assert "bbox inválido" in response.get_json()["error"]

    # Faltan parámetros
    response = client.get(
        f"/api/flood-detection?start=2020-01-01&bbox={SMALL_BBOX_URL}"
    )
    assert response.status_code == 400
    assert "requeridos" in response.get_json()["error"]


def test_flood_stats_success(client):
    """Verifica que el cálculo de área retorne las hectáreas correctamente."""
    with patch("gee.water.calculate_flood_area", return_value=124.56) as mock_calc:
        response = client.get(
            f"/api/flood-stats?start=2020-01-01&end=2020-12-31&bbox={SMALL_BBOX_URL}&satellite=landsat&auto=false&threshold=-14.0"
        )
        assert response.status_code == 200
        data = response.get_json()
        assert data["total_ha"] == 124.56
        mock_calc.assert_called_once_with(
            start="2020-01-01",
            end="2020-12-31",
            bbox=[-92.0, 17.0, -91.0, 18.0],
            satellite="landsat",
            use_auto_threshold=False,
            threshold=-14.0
        )

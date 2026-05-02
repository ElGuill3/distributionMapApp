"""
Tests de integración para el endpoint POST /api/export/bundle.

Dado que Flask+GEE no están disponibles en el entorno de test local,
estos tests usan el mock_ee de conftest.py y crean un cliente Flask
de prueba para verificar el endpoint.

Patrón: Arrange → Act → Assert.
"""
import json
import zipfile
from io import BytesIO
from unittest.mock import patch

import pytest
from flask import Flask
from flask.testing import FlaskClient

from routes.export_routes import export_bp


def create_test_app() -> Flask:
    """Crea una app Flask de prueba con el blueprint de exportación."""
    app = Flask(__name__)
    app.config["TESTING"] = True
    app.register_blueprint(export_bp)
    return app


@pytest.fixture
def client() -> FlaskClient:
    """Cliente Flask de prueba."""
    app = create_test_app()
    with app.test_client() as client:
        yield client


class TestExportBundleEndpoint:
    """Tests para POST /api/export/bundle."""

    def test_valid_request_returns_200(self, client: FlaskClient) -> None:
        """
        GIVEN payload válido con gifPaths vacío
        WHEN POST /api/export/bundle es llamado
        THEN respuesta es 200
        AND Content-Type es application/zip
        """
        payload = {
            "gifPaths": [],
            "panel": "A",
            "seriesData": {
                "dates": ["2020-03-01", "2020-03-17"],
                "variables": {
                    "ndvi": [0.45, 0.52],
                },
            },
            "bbox": [-92.5, 17.0, -91.0, 18.0],
            "metadata": {
                "variableKeys": ["ndvi"],
                "panel": "A",
            },
        }
        response = client.post(
            "/api/export/bundle",
            json=payload,
            content_type="application/json",
        )
        assert response.status_code == 200
        assert response.content_type == "application/zip"

    def test_valid_request_returns_zip_with_correct_files(self, client: FlaskClient) -> None:
        """
        GIVEN payload válido
        WHEN POST /api/export/bundle es llamado
        THEN response data es un ZIP válido
        AND contiene timeseries.csv y metadata.json
        """
        payload = {
            "gifPaths": [],
            "panel": "A",
            "seriesData": {
                "dates": ["2020-03-01", "2020-03-17"],
                "variables": {"ndvi": [0.45, 0.52]},
            },
            "bbox": [-92.5, 17.0, -91.0, 18.0],
            "metadata": {"variableKeys": ["ndvi"], "panel": "A"},
        }
        response = client.post("/api/export/bundle", json=payload)
        zip_bytes = response.data
        buffer = BytesIO(zip_bytes)
        with zipfile.ZipFile(buffer, "r") as zf:
            names = zf.namelist()
            assert "timeseries.csv" in names
            assert "metadata.json" in names

    def test_content_disposition_header_contains_filename(self, client: FlaskClient) -> None:
        """
        GIVEN payload válido
        WHEN POST /api/export/bundle es llamado
        THEN Content-Disposition contiene 'attachment; filename=analysis_export_'
        """
        payload = {
            "gifPaths": [],
            "panel": "A",
            "seriesData": {
                "dates": ["2020-03-01"],
                "variables": {"ndvi": [0.45]},
            },
            "bbox": [-92.5, 17.0, -91.0, 18.0],
            "metadata": {"variableKeys": ["ndvi"], "panel": "A"},
        }
        response = client.post("/api/export/bundle", json=payload)
        assert "attachment" in response.headers.get("Content-Disposition", "")
        assert "analysis_export_" in response.headers.get("Content-Disposition", "")
        assert ".zip" in response.headers.get("Content-Disposition", "")

    def test_missing_content_type_returns_400(self, client: FlaskClient) -> None:
        """
        GIVEN request sin Content-Type application/json
        WHEN POST /api/export/bundle es llamado
        THEN respuesta es 400
        """
        response = client.post("/api/export/bundle", data="not-json")
        assert response.status_code == 400

    def test_malformed_json_returns_400(self, client: FlaskClient) -> None:
        """
        GIVEN body no es JSON válido
        WHEN POST /api/export/bundle es llamado
        THEN respuesta es 400
        """
        response = client.post(
            "/api/export/bundle",
            data="not-json",
            content_type="application/json",
        )
        assert response.status_code == 400

    def test_invalid_schema_returns_400(self, client: FlaskClient) -> None:
        """
        GIVEN payload falta el campo required 'seriesData'
        WHEN POST /api/export/bundle es llamado
        THEN respuesta es 400
        """
        payload = {
            "gifPaths": [],
            "panel": "A",
            # falta seriesData
            "bbox": [-92.5, 17.0, -91.0, 18.0],
            "metadata": {"variableKeys": ["ndvi"], "panel": "A"},
        }
        response = client.post("/api/export/bundle", json=payload)
        assert response.status_code == 400

    def test_invalid_panel_value_returns_400(self, client: FlaskClient) -> None:
        """
        GIVEN panel no es 'A' ni 'B'
        WHEN POST /api/export/bundle es llamado
        THEN respuesta es 400
        """
        payload = {
            "gifPaths": [],
            "panel": "C",  # inválido
            "seriesData": {
                "dates": ["2020-03-01"],
                "variables": {"ndvi": [0.45]},
            },
            "bbox": [-92.5, 17.0, -91.0, 18.0],
            "metadata": {"variableKeys": ["ndvi"], "panel": "C"},
        }
        response = client.post("/api/export/bundle", json=payload)
        assert response.status_code == 400

    def test_nonexistent_gif_returns_404(self, client: FlaskClient) -> None:
        """
        GIVEN gifPaths contiene un archivo que no existe
        WHEN POST /api/export/bundle es llamado
        THEN respuesta es 404
        AND JSON error contiene 'Animation file no longer available'
        """
        payload = {
            "gifPaths": ["gifs/nonexistent_abc123.gif"],
            "panel": "A",
            "seriesData": {
                "dates": ["2020-03-01"],
                "variables": {"ndvi": [0.45]},
            },
            "bbox": [-92.5, 17.0, -91.0, 18.0],
            "metadata": {"variableKeys": ["ndvi"], "panel": "A"},
        }
        response = client.post("/api/export/bundle", json=payload)
        assert response.status_code == 404
        error_data = response.get_json()
        assert error_data is not None
        assert "Animation file no longer available" in error_data["error"]

    def test_empty_dates_returns_400(self, client: FlaskClient) -> None:
        """
        GIVEN seriesData.dates es vacío
        WHEN POST /api/export/bundle es llamado
        THEN respuesta es 400 (ValueError en serialize_series_to_csv)
        """
        payload = {
            "gifPaths": [],
            "panel": "A",
            "seriesData": {
                "dates": [],
                "variables": {},
            },
            "bbox": [-92.5, 17.0, -91.0, 18.0],
            "metadata": {"variableKeys": [], "panel": "A"},
        }
        response = client.post("/api/export/bundle", json=payload)
        assert response.status_code == 400

    def test_csv_has_correct_format_in_zip(self, client: FlaskClient) -> None:
        """
        GIVEN payload con múltiples variables
        WHEN POST /api/export/bundle es llamado
        THEN ZIP contiene timeseries.csv con formato correcto
        """
        payload = {
            "gifPaths": [],
            "panel": "A",
            "seriesData": {
                "dates": ["2020-03-01", "2020-03-17"],
                "variables": {
                    "ndvi": [0.45, 0.52],
                    "temp": [28.3, 29.1],
                },
            },
            "bbox": [-92.5, 17.0, -91.0, 18.0],
            "metadata": {"variableKeys": ["ndvi", "temp"], "panel": "A"},
        }
        response = client.post("/api/export/bundle", json=payload)
        zip_bytes = response.data
        buffer = BytesIO(zip_bytes)
        with zipfile.ZipFile(buffer, "r") as zf:
            csv = zf.read("timeseries.csv").decode()
            lines = csv.strip().split("\n")
            # Verificar header de metadata + header CSV
            assert any("# BBox:" in l for l in lines)
            assert any("# Variables:" in l for l in lines)
            assert "date,ndvi,temp" in lines
            assert "2020-03-01,0.45,28.3" in lines

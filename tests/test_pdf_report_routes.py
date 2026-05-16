"""
Tests de integración para el endpoint POST /api/export/pdf-report.

Patrón: Arrange → Act → Assert.
"""
import base64
import json
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


def _make_payload(
    chart_blob: str = "",
    gif_path: str = "",
    dates: list[str] | None = None,
    variables: dict | None = None,
    bbox: list[float] | None = None,
    variable_keys: list[str] | None = None,
    panel: str = "A",
) -> dict:
    """Helper para construir payload válido."""
    return {
        "chart_blob": chart_blob or "",
        "gif_path": gif_path,
        "series_data": {
            "dates": ["2020-03-01", "2020-03-17"] if dates is None else dates,
            "variables": {"ndvi": [0.45, 0.52]} if variables is None else variables,
        },
        "bbox": bbox or [-92.5, 17.0, -91.0, 18.0],
        "metadata": {
            "variableKeys": variable_keys or ["ndvi"],
            "panel": panel,
        },
    }


class TestExportPdfReportEndpoint:
    """Tests para POST /api/export/pdf-report."""

    def test_missing_content_type_returns_400(self, client: FlaskClient) -> None:
        """
        GIVEN request sin Content-Type application/json
        WHEN POST /api/export/pdf-report es llamado
        THEN respuesta es 400
        """
        response = client.post("/api/export/pdf-report", data="not-json")
        assert response.status_code == 400

    def test_malformed_json_returns_400(self, client: FlaskClient) -> None:
        """
        GIVEN body no es JSON válido
        WHEN POST /api/export/pdf-report es llamado
        THEN respuesta es 400
        """
        response = client.post(
            "/api/export/pdf-report",
            data="not-json",
            content_type="application/json",
        )
        assert response.status_code == 400

    def test_invalid_schema_returns_400(self, client: FlaskClient) -> None:
        """
        GIVEN payload falta campos requeridos (chart_blob)
        WHEN POST /api/export/pdf-report es llamado
        THEN respuesta es 400
        """
        payload = {
            "gif_path": "",
            "series_data": {"dates": ["2020-03-01"], "variables": {"ndvi": [0.45]}},
            "bbox": [-92.5, 17.0, -91.0, 18.0],
            "metadata": {"variableKeys": ["ndvi"], "panel": "A"},
        }
        response = client.post("/api/export/pdf-report", json=payload)
        assert response.status_code == 400

    def test_invalid_panel_value_returns_400(self, client: FlaskClient) -> None:
        """
        GIVEN panel no es 'A' ni 'B'
        WHEN POST /api/export/pdf-report es llamado
        THEN respuesta es 400
        """
        payload = _make_payload(panel="C")
        response = client.post("/api/export/pdf-report", json=payload)
        assert response.status_code == 400

    def test_nonexistent_gif_returns_404(self, client: FlaskClient) -> None:
        """
        GIVEN gif_path apunta a un archivo que no existe
        WHEN POST /api/export/pdf-report es llamado
        THEN respuesta es 404
        AND JSON error contiene 'Animation file no longer available'
        """
        payload = _make_payload(gif_path="gifs/nonexistent_abc123.gif")
        response = client.post("/api/export/pdf-report", json=payload)
        assert response.status_code == 404
        error_data = response.get_json()
        assert error_data is not None
        assert "Animation file no longer available" in error_data["error"]

    def test_empty_chart_blob_is_accepted(self, client: FlaskClient) -> None:
        """
        GIVEN payload con chart_blob vacío
        WHEN POST /api/export/pdf-report es llamado
        THEN respuesta NO es 400 (se permite blob vacío para fallback)
        """
        payload = _make_payload(chart_blob="")
        response = client.post("/api/export/pdf-report", json=payload)
        # We espera 500 por fallar WeasyPrint, no 400 por validación
        assert response.status_code != 400

    def test_pdf_generation_success(self, client: FlaskClient) -> None:
        """
        GIVEN payload válido con chart_blob y sin GIF (fallback sin GIF)
        WHEN POST /api/export/pdf-report es llamado
        THEN respuesta es 200
        AND Content-Type es application/pdf
        AND Content-Disposition contiene filename .pdf
        AND el body es PDF no vacío
        """
        # Generar un PNG mínimo en base64 (1x1 pixel PNG)
        minimal_png = (
            b"\x89PNG\r\n\x1a\n\x00\x00\x00\rIHDR\x00\x00\x00\x01"
            b"\x00\x00\x00\x01\x08\x02\x00\x00\x00\x90wS\xde\x00"
            b"\x00\x00\x0cIDATx\x9cc\xf8\xcf\xc0\x00\x00\x00\x03"
            b"\x00\x01\x00\x05\xfe\xd4\x00\x00\x00\x00IEND\xaeB`\x82"
        )
        chart_b64 = base64.b64encode(minimal_png).decode()

        payload = _make_payload(
            chart_blob=chart_b64,
            gif_path="",  # Sin GIF
        )

        response = client.post("/api/export/pdf-report", json=payload)

        assert response.status_code == 200, response.data.decode()
        assert response.content_type == "application/pdf"
        cd = response.headers.get("Content-Disposition", "")
        assert "attachment" in cd
        assert ".pdf" in cd
        # Verificar que el body no está vacío
        assert len(response.data) > 0

    def test_content_disposition_filename_format(self, client: FlaskClient) -> None:
        """
        GIVEN payload válido
        WHEN POST /api/export/pdf-report es llamado
        THEN Content-Disposition contiene 'attachment; filename=analysis_report_'
        AND .pdf como extensión
        """
        minimal_png = (
            b"\x89PNG\r\n\x1a\n\x00\x00\x00\rIHDR\x00\x00\x00\x01"
            b"\x00\x00\x00\x01\x08\x02\x00\x00\x00\x90wS\xde\x00"
            b"\x00\x00\x0cIDATx\x9cc\xf8\xcf\xc0\x00\x00\x00\x03"
            b"\x00\x01\x00\x05\xfe\xd4\x00\x00\x00\x00IEND\xaeB`\x82"
        )
        chart_b64 = base64.b64encode(minimal_png).decode()

        payload = _make_payload(chart_blob=chart_b64, gif_path="")

        response = client.post("/api/export/pdf-report", json=payload)

        cd = response.headers.get("Content-Disposition", "")
        assert "analysis_report_" in cd
        assert ".pdf" in cd

    def test_series_data_with_multiple_variables(self, client: FlaskClient) -> None:
        """
        GIVEN payload con múltiples variables
        WHEN POST /api/export/pdf-report es llamado
        THEN respuesta es 200 con PDF válido
        """
        minimal_png = (
            b"\x89PNG\r\n\x1a\n\x00\x00\x00\rIHDR\x00\x00\x00\x01"
            b"\x00\x00\x00\x01\x08\x02\x00\x00\x00\x90wS\xde\x00"
            b"\x00\x00\x0cIDATx\x9cc\xf8\xcf\xc0\x00\x00\x00\x03"
            b"\x00\x01\x00\x05\xfe\xd4\x00\x00\x00\x00IEND\xaeB`\x82"
        )
        chart_b64 = base64.b64encode(minimal_png).decode()

        payload = _make_payload(
            chart_blob=chart_b64,
            dates=["2020-03-01", "2020-03-17"],
            variables={
                "ndvi": [0.45, 0.52],
                "temp": [28.3, 29.1],
            },
            variable_keys=["ndvi", "temp"],
            gif_path="",
        )

        response = client.post("/api/export/pdf-report", json=payload)

        assert response.status_code == 200
        assert response.content_type == "application/pdf"
        assert len(response.data) > 0

    def test_content_length_header_present(self, client: FlaskClient) -> None:
        """
        GIVEN payload válido
        WHEN POST /api/export/pdf-report es llamado
        THEN Content-Length header está presente y > 0
        """
        minimal_png = (
            b"\x89PNG\r\n\x1a\n\x00\x00\x00\rIHDR\x00\x00\x00\x01"
            b"\x00\x00\x00\x01\x08\x02\x00\x00\x00\x90wS\xde\x00"
            b"\x00\x00\x0cIDATx\x9cc\xf8\xcf\xc0\x00\x00\x00\x03"
            b"\x00\x01\x00\x05\xfe\xd4\x00\x00\x00\x00IEND\xaeB`\x82"
        )
        chart_b64 = base64.b64encode(minimal_png).decode()
        payload = _make_payload(chart_blob=chart_b64, gif_path="")

        response = client.post("/api/export/pdf-report", json=payload)

        assert "Content-Length" in response.headers
        content_length = int(response.headers["Content-Length"])
        assert content_length > 0

    def test_bbox_validated_as_4_elements(self, client: FlaskClient) -> None:
        """
        GIVEN bbox con solo 2 elementos
        WHEN POST /api/export/pdf-report es llamado
        THEN respuesta es 400 por validación de schema
        """
        payload = _make_payload(bbox=[-92.5, 17.0])

        response = client.post("/api/export/pdf-report", json=payload)

        assert response.status_code == 400

    def test_empty_dates_returns_error(self, client: FlaskClient) -> None:
        """
        GIVEN series_data.dates es vacío
        WHEN POST /api/export/pdf-report es llamado
        THEN respuesta es 400 (validación de schema falla)
        """
        payload = _make_payload(dates=[], variables={})

        response = client.post("/api/export/pdf-report", json=payload)

        assert response.status_code == 400
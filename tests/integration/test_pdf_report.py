"""
Integration tests for PDF report with AI-powered MiniMax integration.
"""
import base64
from unittest.mock import patch, MagicMock

import pytest
from flask import Flask
from flask.testing import FlaskClient

from routes.export_routes import export_bp


def create_test_app() -> Flask:
    """Create a test Flask app with the export blueprint."""
    app = Flask(__name__)
    app.config["TESTING"] = True
    app.register_blueprint(export_bp)
    return app


@pytest.fixture
def client() -> FlaskClient:
    """Flask test client."""
    app = create_test_app()
    with app.test_client() as client:
        yield client


def _minimal_chart_blob() -> str:
    """Minimal 1x1 PNG as base64."""
    minimal_png = (
        b"\x89PNG\r\n\x1a\n\x00\x00\x00\rIHDR\x00\x00\x00\x01"
        b"\x00\x00\x00\x01\x08\x02\x00\x00\x00\x90wS\xde\x00"
        b"\x00\x00\x0cIDATx\x9cc\xf8\xcf\xc0\x00\x00\x00\x03"
        b"\x00\x01\x00\x05\xfe\xd4\x00\x00\x00\x00IEND\xaeB`\x82"
    )
    return base64.b64encode(minimal_png).decode()


def _make_payload() -> dict:
    """Build a valid PDF report payload."""
    return {
        "chart_blob": _minimal_chart_blob(),
        "gif_path": "",
        "series_data": {
            "dates": ["2020-03-01", "2020-03-02", "2020-03-03"],
            "variables": {"ndvi": [0.45, 0.52, 0.48]},
        },
        "bbox": [-92.5, 17.0, -91.0, 18.0],
        "metadata": {
            "variableKeys": ["ndvi"],
        },
    }


@patch("routes.export_routes.render_pdf_report", return_value=b"fake_pdf_bytes")
class TestPdfReportEndpoint:
    """Tests for POST /api/export/pdf-report with AI report."""

    @patch("routes.export_routes.generate_ai_report")
    def test_pdf_report_success(self, mock_gen_report, mock_render, client: FlaskClient) -> None:
        """
        GIVEN payload válido y MiniMax mockeado
        WHEN POST /api/export/pdf-report es llamado
        THEN retorna 200 con aplicación/pdf
        """
        mock_gen_report.return_value = {
            "report_html": "<h3>Report</h3><p>Test analysis</p>",
            "selected_date": "2020-03-02",
            "frame_caption": "Capt"
        }

        payload = _make_payload()
        response = client.post("/api/export/pdf-report", json=payload)

        assert response.status_code == 200
        assert response.content_type == "application/pdf"
        assert response.data == b"fake_pdf_bytes"

    @patch("routes.export_routes.generate_ai_report")
    def test_pdf_report_with_task_id(self, mock_gen_report, mock_render, client: FlaskClient) -> None:
        """
        GIVEN payload válido, task_id y MiniMax mockeado
        WHEN POST /api/export/pdf-report?task_id=test_task es llamado
        THEN reporta progreso en progress_queues y retorna 200 pdf
        """
        mock_gen_report.return_value = {
            "report_html": "<h3>Report</h3>",
            "selected_date": "2020-03-02",
            "frame_caption": "Capt"
        }

        from services.gif_service import progress_queues

        payload = _make_payload()
        response = client.post("/api/export/pdf-report?task_id=test_task_pdf", json=payload)

        assert response.status_code == 200
        assert response.content_type == "application/pdf"
        assert response.data == b"fake_pdf_bytes"
        
        # El queue debe haber sido limpiado al finalizar
        assert "test_task_pdf" not in progress_queues

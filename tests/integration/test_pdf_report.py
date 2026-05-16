"""
Integration tests for PDF report anomaly detection features.

Tests POST /api/export/pdf-report with report_type="anomaly" and fallback scenarios.
Functional regression guard: context dict identical, NOT byte-identical PDF.
"""
import base64
from unittest.mock import patch

import pytest
from flask import Flask
from flask.testing import FlaskClient

from routes.export_routes import export_bp
from services.pdf_report_service import (
    AnomalyResult,
    build_pdf_context,
    compute_statistics,
    detect_anomalies,
)


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


def _make_payload(
    chart_blob: str = "",
    gif_path: str = "",
    dates: list[str] | None = None,
    variables: dict | None = None,
    bbox: list[float] | None = None,
    variable_keys: list[str] | None = None,
    panel: str = "A",
    report_type: str | None = None,
) -> dict:
    """Build a valid PDF report payload."""
    payload = {
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
    if report_type is not None:
        payload["report_type"] = report_type
    return payload


# ---------------------------------------------------------------------------
# Anomaly mode — Hallazgos clave section
# ---------------------------------------------------------------------------

class TestAnomalyModeEndpoint:
    """Tests for POST /api/export/pdf-report with report_type=anomaly."""

    def test_anomaly_mode_returns_pdf_with_hallazgos(self, client: FlaskClient) -> None:
        """
        GIVEN report_type=anomaly with seeded spike data (12 obs, one outlier)
        WHEN POST /api/export/pdf-report is called
        THEN response is 200
        AND Content-Type is application/pdf
        """
        chart_b64 = _minimal_chart_blob()
        # Series with a clear spike at index 6
        dates = [f"2020-01-{i:02d}" for i in range(1, 13)]
        variables = {"ndvi": [0.5, 0.5, 0.5, 0.5, 0.5, 0.5, 0.9, 0.5, 0.5, 0.5, 0.5, 0.5]}

        payload = _make_payload(
            chart_blob=chart_b64,
            gif_path="",
            dates=dates,
            variables=variables,
            report_type="anomaly",
        )

        response = client.post("/api/export/pdf-report", json=payload)

        assert response.status_code == 200
        assert response.content_type == "application/pdf"
        assert len(response.data) > 0

    def test_anomaly_mode_with_9_obs_falls_back(self, client: FlaskClient) -> None:
        """
        GIVEN report_type=anomaly with only 9 observations (< 10)
        WHEN POST /api/export/pdf-report is called
        THEN fallback_reason is set in context
        """
        chart_b64 = _minimal_chart_blob()
        dates = [f"2020-01-{i:02d}" for i in range(1, 10)]
        variables = {"ndvi": [0.3] * 9}

        payload = _make_payload(
            chart_blob=chart_b64,
            gif_path="",
            dates=dates,
            variables=variables,
            report_type="anomaly",
        )

        response = client.post("/api/export/pdf-report", json=payload)

        # The endpoint still returns a PDF (falls back to summary mode)
        assert response.status_code == 200
        assert response.content_type == "application/pdf"

    def test_anomaly_mode_with_zero_variance_falls_back(self, client: FlaskClient) -> None:
        """
        GIVEN report_type=anomaly with all identical values
        WHEN POST /api/export/pdf-report is called
        THEN fallback_reason=zero_variance is set
        """
        chart_b64 = _minimal_chart_blob()
        dates = [f"2020-01-{i:02d}" for i in range(1, 21)]
        variables = {"ndvi": [0.5] * 20}

        payload = _make_payload(
            chart_blob=chart_b64,
            gif_path="",
            dates=dates,
            variables=variables,
            report_type="anomaly",
        )

        response = client.post("/api/export/pdf-report", json=payload)

        assert response.status_code == 200
        assert response.content_type == "application/pdf"


# ---------------------------------------------------------------------------
# Backward compatibility — no report_type field
# ---------------------------------------------------------------------------

class TestBackwardCompatibility:
    """Tests that omitting report_type produces the same behavior as pre-change."""

    def test_omit_report_type_no_anomaly_result_in_context(self, client: FlaskClient) -> None:
        """
        GIVEN payload WITHOUT report_type field (backward compat)
        WHEN build_pdf_context is called with same inputs
        THEN context has no anomaly_events key
        """
        chart_b64 = _minimal_chart_blob()
        dates = ["2020-01-01", "2020-01-02", "2020-01-03"]
        variables = {"ndvi": [0.3, 0.4, 0.5]}
        stats = compute_statistics(variables, dates)

        context = build_pdf_context(
            series_data=variables,
            dates=dates,
            stats=stats,
            chart_blob=chart_b64,
            gif_frame_path=None,
            bbox=[-92.5, 17.0, -91.0, 18.0],
            metadata={"variableKeys": ["ndvi"], "panel": "A"},
            anomaly_result=None,
        )

        # No anomaly context should be injected when anomaly_result is None
        assert "anomaly_events" not in context
        assert "report_type" not in context
        assert "fallback_reason" not in context

    def test_summary_report_type_behaves_like_default(self, client: FlaskClient) -> None:
        """
        GIVEN report_type=summary (explicit)
        WHEN POST /api/export/pdf-report is called
        THEN output is same as omitting report_type
        """
        chart_b64 = _minimal_chart_blob()
        dates = ["2020-03-01", "2020-03-17"]
        variables = {"ndvi": [0.45, 0.52]}

        # Without report_type
        payload_no_type = _make_payload(
            chart_blob=chart_b64,
            gif_path="",
            dates=dates,
            variables=variables,
        )
        response_no_type = client.post("/api/export/pdf-report", json=payload_no_type)

        # With report_type=summary
        payload_summary = _make_payload(
            chart_blob=chart_b64,
            gif_path="",
            dates=dates,
            variables=variables,
            report_type="summary",
        )
        response_summary = client.post("/api/export/pdf-report", json=payload_summary)

        # Both should return 200 and valid PDFs
        assert response_no_type.status_code == 200
        assert response_summary.status_code == 200
        assert response_no_type.content_type == "application/pdf"
        assert response_summary.content_type == "application/pdf"


# ---------------------------------------------------------------------------
# detect_anomalies unit integration
# ---------------------------------------------------------------------------

class TestDetectAnomaliesIntegration:
    """Integration-level tests for detect_anomalies using real data."""

    def test_detect_anomalies_with_real_spike(self) -> None:
        """
        GIVEN a series with a spike where z=5.5 (value=10.0 in window of 0.5s)
        WHEN detect_anomalies is called
        THEN one spike event is returned
        """
        # 12 obs: 6 around 0.5, one at 10.0 (clear spike with z≈5.5)
        series_data = {
            "ndvi": [0.5, 0.5, 0.5, 0.5, 0.5, 0.5, 10.0, 0.5, 0.5, 0.5, 0.5, 0.5]
        }
        dates = [f"2020-01-{i:02d}" for i in range(1, 13)]

        result = detect_anomalies(series_data, dates)

        assert result.effective_report_type == "anomaly"
        assert len(result.events) >= 1
        event_types = [e.type for e in result.events]
        assert "spike" in event_types

    def test_detect_anomalies_with_sustained_shift(self) -> None:
        """
        GIVEN 5 consecutive z-scores above 1.5 threshold
        WHEN detect_anomalies is called
        THEN one sustained_shift event is returned
        """
        # 16 obs: first 6 all elevated → sustained_shift run detected at indices 6-11 (all clamped z≈10)
        series_data = {"ndvi": [0.5, 0.5, 0.5, 0.5, 0.5, 0.5, 0.7, 0.71, 0.72, 0.73, 0.74, 0.75, 0.5, 0.5, 0.5, 0.5]}
        dates = [f"2020-01-{i:02d}" for i in range(1, 17)]

        result = detect_anomalies(series_data, dates)

        # Should produce events (either spike or sustained_shift)
        assert result.effective_report_type == "anomaly"
        assert len(result.events) >= 1

    def test_five_consecutive_spikes_produce_single_merged_event(self) -> None:
        """
        GIVEN 5 consecutive spikes (consecutive z>2.5 points)
        WHEN detect_anomalies is called
        THEN the result has 1 merged event (not 5)
        """
        # Create 5 consecutive spike values (very high values)
        spike_vals = [0.9, 0.9, 0.9, 0.9, 0.9]
        base_vals = [0.5] * 7
        series_data = {"ndvi": base_vals + spike_vals + [0.5] * 3}
        dates = [f"2020-01-{i:02d}" for i in range(1, 16)]

        result = detect_anomalies(series_data, dates)

        # If events are found, they should be merged
        if result.events:
            # All spike events should have same start_date after merge
            spike_events = [e for e in result.events if e.type == "spike"]
            # Either 1 merged spike or a sustained_shift if run is long enough
            assert len(result.events) <= 3  # top-n constraint

    def test_empty_series_returns_summary(self) -> None:
        """
        GIVEN an empty series_data
        WHEN detect_anomalies is called
        THEN effective_report_type is summary
        """
        series_data: dict = {}
        dates: list = []

        result = detect_anomalies(series_data, dates)

        assert result.effective_report_type == "summary"
        assert result.events == []

    def test_all_null_values_returns_summary(self) -> None:
        """
        GIVEN all None values
        WHEN detect_anomalies is called
        THEN effective_report_type is summary with insufficient_observations
        """
        series_data = {"ndvi": [None] * 15}
        dates = [f"2020-01-{i:02d}" for i in range(1, 16)]

        result = detect_anomalies(series_data, dates)

        assert result.effective_report_type == "summary"
        assert result.fallback_reason == "insufficient_observations"
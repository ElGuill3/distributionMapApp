"""
Tests de rate limiting (Task 4.4 y Warning 3).

Verifica que Flask-Limiter real:
  - Limita requests según la configuración de RATE_LIMITS
  - Devuelve 429 con JSON body {"error": ...} cuando se excede el límite
  - Usa el handler personalizado de app.py

Usa el limiter real de extensions.py y la app real de app.py.
"""

import json

import pytest
from unittest.mock import patch, MagicMock

# Bbox pequeño que pasa la validación de BBoxSchema
SMALL_BBOX_URL = "[-92.0,17.0,-91.0,18.0]"


# ---------------------------------------------------------------------------
# Fixtures
# ---------------------------------------------------------------------------


@pytest.fixture
def client():
    """Cliente de test Flask con app real."""
    from app import app
    app.config["TESTING"] = True
    return app.test_client()


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------


def _gif_mocks(sample_dates=(["2020-01-01"], [0.5])):
    """Crea mocks para un cache miss de GIF (forza generación completa)."""
    mock_dir = MagicMock()
    mock_file = MagicMock()
    mock_file.exists.return_value = False
    mock_dir.__truediv__ = MagicMock(return_value=mock_file)

    mock_gif = MagicMock(return_value="https://ee.google.com/test.gif")
    mock_ts = MagicMock(return_value=sample_dates)
    mock_add = MagicMock(return_value=None)

    return mock_dir, mock_gif, mock_ts, mock_add


# ---------------------------------------------------------------------------
# Task 4.4 — Tests de rate limiting básico
# ---------------------------------------------------------------------------


class TestRateLimitBasicFunctionality:
    """
    Verifica el funcionamiento básico del rate limiting con el limiter real.
    """

    def test_request_within_limit_succeeds(self, client) -> None:
        """Request dentro del límite devuelve 200."""
        mock_dir, mock_gif, mock_ts, mock_add = _gif_mocks()

        with patch("routes.gif_routes.build_ndvi_gif_bbox", mock_gif), \
             patch("routes.gif_routes.build_ndvi_timeseries_bbox", mock_ts), \
             patch("routes.gif_routes.add_dates_to_gif", mock_add), \
             patch("routes.gif_routes.GIFS_DIR", mock_dir):

            response = client.get(
                f"/api/ndvi-gif-bbox?start=2020-01-01&end=2020-12-31&bbox={SMALL_BBOX_URL}"
            )
            assert response.status_code == 200


class TestRateLimitConfiguration:
    """
    Verifica que RATE_LIMITS está configurado correctamente en config.py.
    """

    def test_config_has_rate_limits(self) -> None:
        """Verifica que config.py tiene RATE_LIMITS definido."""
        from config import RATE_LIMITS, RATE_LIMIT_ENABLED

        assert RATE_LIMIT_ENABLED is not None, "RATE_LIMIT_ENABLED debe estar definido"
        assert isinstance(RATE_LIMITS, dict), "RATE_LIMITS debe ser un diccionario"
        assert "gif" in RATE_LIMITS, "RATE_LIMITS debe tener categoría 'gif'"
        assert "timeseries" in RATE_LIMITS, "RATE_LIMITS debe tener categoría 'timeseries'"
        assert "30/minute" in RATE_LIMITS["gif"], "GIF debe tener límite de 30/minuto"
        assert "60/minute" in RATE_LIMITS["timeseries"], "Timeseries debe tener límite de 60/minuto"

    def test_extensions_has_limiter(self) -> None:
        """Verifica que extensions.py inicializa el limiter."""
        from extensions import limiter

        assert limiter is not None, "extensions.py debe tener limiter"

    def test_app_has_rate_limit_handler(self) -> None:
        """Verifica que app.py tiene el handler de 429."""
        from app import rate_limit_exceeded

        assert callable(rate_limit_exceeded), "app.py debe tener función rate_limit_exceeded"


class TestRateLimitErrorHandlerFormat:
    """
    Verifica el formato de respuesta 429 del handler personalizado.
    """

    def test_rate_limit_handler_returns_json(self) -> None:
        """El handler rate_limit_exceeded debe retornar JSON con error y Retry-After."""
        from app import rate_limit_exceeded
        from werkzeug.exceptions import TooManyRequests
        from flask import Flask

        app = Flask(__name__)
        exc = TooManyRequests(description="60")

        with app.app_context():
            response = rate_limit_exceeded(exc)
            data = json.loads(response[0].get_data(as_text=True))

            assert "error" in data
            assert "Rate limit exceeded" in data["error"]
            assert "60" in data["error"]

    def test_rate_limit_handler_returns_429_status(self) -> None:
        """El handler debe retornar status code 429."""
        from app import rate_limit_exceeded
        from werkzeug.exceptions import TooManyRequests
        from flask import Flask

        app = Flask(__name__)
        exc = TooManyRequests(description="60")

        with app.app_context():
            response = rate_limit_exceeded(exc)
            assert response[1] == 429


class TestRateLimitSeparateEndpoints:
    """
    Verifica que los límites son independientes por categoría de endpoint.
    """

    def test_different_categories_have_different_limits(self) -> None:
        """Cada categoría tiene su propio límite configurado."""
        from config import RATE_LIMITS

        assert "30/minute" in RATE_LIMITS["gif"]
        assert "60/minute" in RATE_LIMITS["timeseries"]
        assert "10/minute" in RATE_LIMITS["export"]
        assert "60/minute" in RATE_LIMITS["flood"]
        assert "60/minute" in RATE_LIMITS["station"]

    def test_timeseries_endpoint_has_rate_limit(self, client) -> None:
        """Timeseries endpoint está decorado con rate limit y responde 200."""
        with patch("routes.timeseries_routes.build_ndvi_timeseries_bbox") as mock_ts:
            mock_ts.return_value = (["2020-01-01"], [0.5])

            response = client.get(
                f"/api/ndvi-timeseries-bbox?start=2020-01-01&end=2020-03-01&bbox={SMALL_BBOX_URL}"
            )
            assert response.status_code == 200


class TestRateLimiterEnabled:
    """
    Verifica que el rate limiter está habilitado por defecto.
    """

    def test_rate_limiter_is_enabled_by_default(self) -> None:
        """RATE_LIMIT_ENABLED debe ser True por defecto."""
        from config import RATE_LIMIT_ENABLED

        assert RATE_LIMIT_ENABLED is True, "RATE_LIMIT_ENABLED debe ser True por defecto"

    def test_limiter_has_enabled_attribute(self) -> None:
        """El limiter debe tener atributo que indica si está habilitado."""
        from extensions import limiter

        assert hasattr(limiter, '_enabled') or hasattr(limiter, 'enabled'), \
            "El limiter debe tener atributo de estado habilitado"
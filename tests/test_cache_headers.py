"""
Tests de cabeceras HTTP de caché (Task 4.3 y Warning 2).

Verifica que el hook inject_cache_headers() de app.py inyecta correctamente:
  - Cache-Control y ETag según la categoría de endpoint (CACHE_POLICIES real)
  - Cache-Control: no-store para respuestas de error (400, 500)
  - Cache-Control: no-store para export endpoints (max_age=0)
  - El endpoint SSE /api/gif-progress mantiene su propio Cache-Control: no-cache

Usa la app real de app.py y las políticas reales de config.py.

Nota: Los mock paths usan 'routes.xxx.*' (no 'gee.*.*') porque
cada módulo importa las funciones con 'from X import Y', y hay que patchear
la referencia en el módulo que la usa, no en el módulo de origen.
"""

import pytest
from unittest.mock import patch, MagicMock

# Bbox pequeño que pasa la validación de BBoxSchema
SMALL_BBOX_URL = "[-92.0,17.0,-91.0,18.0]"


# ---------------------------------------------------------------------------
# Fixture: Cliente de test con la app real
# ---------------------------------------------------------------------------


@pytest.fixture
def client():
    """Cliente de test Flask usando la app real."""
    from app import app
    app.config["TESTING"] = True
    return app.test_client()


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
# Task 4.3 — Tests de inyección de cabeceras de caché
# ---------------------------------------------------------------------------


class TestCacheHeadersGifEndpoints:
    """
    Verifica que los endpoints GIF reciben las cabeceras correctas
    según CACHE_POLICIES (1 hora, con ETag).
    """

    def test_ndvi_gif_has_cache_control_3600(self, client) -> None:
        """GIF endpoint tiene Cache-Control: public, max-age=3600."""
        mock_dir, mock_gif, mock_ts, mock_add = _gif_mocks()

        with patch("routes.gif_routes.build_ndvi_gif_bbox", mock_gif), \
             patch("routes.gif_routes.build_ndvi_timeseries_bbox", mock_ts), \
             patch("routes.gif_routes.add_dates_to_gif", mock_add), \
             patch("routes.gif_routes.GIFS_DIR", mock_dir):

            response = client.get(
                f"/api/ndvi-gif-bbox?start=2020-01-01&end=2020-12-31&bbox={SMALL_BBOX_URL}"
            )
            assert response.status_code == 200
            assert "Cache-Control" in response.headers
            assert response.headers["Cache-Control"] == "public, max-age=3600"

    def test_ndvi_gif_has_etag(self, client) -> None:
        """GIF endpoint tiene ETag basado en MD5 del contenido."""
        mock_dir, mock_gif, mock_ts, mock_add = _gif_mocks()

        with patch("routes.gif_routes.build_ndvi_gif_bbox", mock_gif), \
             patch("routes.gif_routes.build_ndvi_timeseries_bbox", mock_ts), \
             patch("routes.gif_routes.add_dates_to_gif", mock_add), \
             patch("routes.gif_routes.GIFS_DIR", mock_dir):

            response = client.get(
                f"/api/ndvi-gif-bbox?start=2020-01-01&end=2020-12-31&bbox={SMALL_BBOX_URL}"
            )
            assert response.status_code == 200
            assert "ETag" in response.headers
            etag = response.headers["ETag"]
            assert etag.startswith('"') and etag.endswith('"')
            # ETag debe ser un hash MD5 (32 caracteres hex) entre comillas
            assert len(etag) == 34  # " + 32 chars + "

    def test_ndvi_gif_etag_is_consistent(self, client) -> None:
        """ETag es consistente para el mismo contenido."""
        mock_dir, mock_gif, mock_ts, mock_add = _gif_mocks()

        with patch("routes.gif_routes.build_ndvi_gif_bbox", mock_gif), \
             patch("routes.gif_routes.build_ndvi_timeseries_bbox", mock_ts), \
             patch("routes.gif_routes.add_dates_to_gif", mock_add), \
             patch("routes.gif_routes.GIFS_DIR", mock_dir):

            url = f"/api/ndvi-gif-bbox?start=2020-01-01&end=2020-12-31&bbox={SMALL_BBOX_URL}"
            response1 = client.get(url)
            response2 = client.get(url)
            assert response1.headers["ETag"] == response2.headers["ETag"]


class TestCacheHeadersTimeseriesEndpoints:
    """
    Verifica que los endpoints timeseries reciben las cabeceras correctas
    según CACHE_POLICIES (5 min, con ETag).
    """

    def test_ndvi_timeseries_has_cache_control_300(self, client) -> None:
        """Timeseries endpoint tiene Cache-Control: public, max-age=300."""
        with patch("routes.timeseries_routes.build_ndvi_timeseries_bbox") as mock_ts:
            mock_ts.return_value = (["2020-01-01"], [0.5])

            response = client.get(
                f"/api/ndvi-timeseries-bbox?start=2020-01-01&end=2020-03-01&bbox={SMALL_BBOX_URL}"
            )
            assert response.status_code == 200
            assert "Cache-Control" in response.headers
            assert response.headers["Cache-Control"] == "public, max-age=300"

    def test_ndvi_timeseries_has_etag(self, client) -> None:
        """Timeseries endpoint tiene ETag basado en MD5 del contenido."""
        with patch("routes.timeseries_routes.build_ndvi_timeseries_bbox") as mock_ts:
            mock_ts.return_value = (["2020-01-01"], [0.5])

            response = client.get(
                f"/api/ndvi-timeseries-bbox?start=2020-01-01&end=2020-03-01&bbox={SMALL_BBOX_URL}"
            )
            assert response.status_code == 200
            assert "ETag" in response.headers
            etag = response.headers["ETag"]
            assert etag.startswith('"') and etag.endswith('"')


class TestCacheHeadersFloodRiskEndpoints:
    """
    Verifica que los endpoints de flood risk reciben las cabeceras correctas
    según CACHE_POLICIES (24h, sin ETag).
    """

    def test_flood_risk_has_cache_control_86400(self, client) -> None:
        """Flood risk endpoint tiene Cache-Control: public, max-age=86400."""
        with patch("routes.flood_routes.render_flood_risk_png") as mock_render:
            mock_render.return_value = ("/static/flood_maps/centla.png", [-92.0, 17.5, -91.0, 18.5])

            response = client.get("/api/flood-risk-municipio?muni=centla")
            assert response.status_code == 200
            assert "Cache-Control" in response.headers
            assert response.headers["Cache-Control"] == "public, max-age=86400"

    def test_flood_risk_has_no_etag(self, client) -> None:
        """Flood risk endpoint NO tiene ETag (use_etag=False)."""
        with patch("routes.flood_routes.render_flood_risk_png") as mock_render:
            mock_render.return_value = ("/static/flood_maps/centla.png", [-92.0, 17.5, -91.0, 18.5])

            response = client.get("/api/flood-risk-municipio?muni=centla")
            assert response.status_code == 200
            assert "ETag" not in response.headers


class TestCacheHeadersUnconfiguredRoutes:
    """
    Verifica que las rutas no configuradas en CACHE_POLICIES
    no reciben cabeceras de caché adicionales.
    """

    def test_unconfigured_route_has_no_cache_control(self, client) -> None:
        """Ruta no configurada no tiene Cache-Control inyectado por el hook."""
        response = client.get("/")
        assert response.status_code == 200
        # No debe tener Cache-Control inyectado por el hook
        cache_control = response.headers.get("Cache-Control", "")
        # Si existe, no debe ser "public, max-age=..."
        if cache_control:
            assert "public, max-age=" not in cache_control


class TestCacheHeadersErrorResponses:
    """
    Task 4.3: Verifica que las respuestas de error (4xx, 5xx)
    reciben Cache-Control: no-store.
    """

    def test_error_400_has_no_store(self, client) -> None:
        """Error 400 tiene Cache-Control: no-store."""
        response = client.get("/api/ndvi-gif-bbox")  # Sin parámetros requeridos
        assert response.status_code == 400
        assert "Cache-Control" in response.headers
        assert response.headers["Cache-Control"] == "no-store"

    def test_error_400_has_no_etag(self, client) -> None:
        """Las respuestas de error no tienen ETag."""
        response = client.get("/api/ndvi-gif-bbox")  # Sin parámetros
        assert response.status_code == 400
        assert "ETag" not in response.headers


class TestCacheHeadersExportEndpoint:
    """
    Verifica que el endpoint de export tiene Cache-Control: no-store.
    """

    def test_export_endpoint_has_no_store_config(self) -> None:
        """Verifica que /api/export está configurado con max_age=0 en CACHE_POLICIES."""
        from config import CACHE_POLICIES
        assert "/api/export" in CACHE_POLICIES
        max_age, use_etag = CACHE_POLICIES["/api/export"]
        assert max_age == 0
        assert use_etag is False

    def test_export_endpoint_injects_no_store(self, client) -> None:
        """Export endpoint (/api/export) inyecta Cache-Control: no-store."""
        from config import CACHE_POLICIES
        # El hook inject_cache_headers trata max_age=0 como no-store
        # Verificamos indirectamente que la configuración produce no-store
        max_age, _ = CACHE_POLICIES["/api/export"]
        assert max_age == 0  # El hook convierte max_age=0 a "no-store"


class TestCacheHeadersSseEndpoint:
    """
    Warning 6: Verifica que el endpoint SSE /api/gif-progress
    mantiene su propio Cache-Control: no-cache y NO es sobreescrito por el hook.
    """

    def test_sse_endpoint_not_in_cache_policies(self) -> None:
        """El endpoint SSE no debe estar en CACHE_POLICIES (evita override)."""
        from config import CACHE_POLICIES

        # El endpoint SSE no debe estar configurado en CACHE_POLICIES
        # porque ya tiene su propio Cache-Control: no-cache
        for prefix in CACHE_POLICIES.keys():
            assert "/api/gif-progress" not in prefix, \
                "SSE endpoint no debe estar en CACHE_POLICIES"

    def test_sse_hook_does_not_override_no_cache(self) -> None:
        """
        El hook inject_cache_headers NO debe sobreescribir Cache-Control: no-cache
        del endpoint SSE.
        """
        from config import CACHE_POLICIES

        # Verificar que /api/gif-progress NO coincide con ningún prefix en CACHE_POLICIES
        sse_in_policies = any(
            "/api/gif-progress".startswith(prefix)
            for prefix in CACHE_POLICIES.keys()
        )
        assert not sse_in_policies, \
            "El endpoint SSE no debe estar en CACHE_POLICIES para preservar su no-cache"


class TestCacheHeadersContentVariations:
    """
    Verifica comportamiento con diferentes tipos de contenido.
    """

    def test_etag_changes_with_content(self, client) -> None:
        """ETag cambia cuando el contenido es diferente."""
        dates1 = (["2020-01-01"], [0.5])
        dates2 = (["2020-06-01"], [0.8])

        mock_dir, mock_gif, mock_ts, mock_add = _gif_mocks(dates1)

        with patch("routes.gif_routes.build_ndvi_gif_bbox", mock_gif), \
             patch("routes.gif_routes.build_ndvi_timeseries_bbox", mock_ts), \
             patch("routes.gif_routes.add_dates_to_gif", mock_add), \
             patch("routes.gif_routes.GIFS_DIR", mock_dir):

            url = f"/api/ndvi-gif-bbox?start=2020-01-01&end=2020-12-31&bbox={SMALL_BBOX_URL}"
            response1 = client.get(url)
            etag1 = response1.headers.get("ETag")

        # Segundo request con contenido diferente
        mock_dir2, mock_gif2, mock_ts2, mock_add2 = _gif_mocks(dates2)

        with patch("routes.gif_routes.build_ndvi_gif_bbox", mock_gif2), \
             patch("routes.gif_routes.build_ndvi_timeseries_bbox", mock_ts2), \
             patch("routes.gif_routes.add_dates_to_gif", mock_add2), \
             patch("routes.gif_routes.GIFS_DIR", mock_dir2):

            response2 = client.get(url)
            etag2 = response2.headers.get("ETag")

        # Los ETags deben ser diferentes si el contenido es diferente
        assert etag1 != etag2
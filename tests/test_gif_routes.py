"""
Tests de caché GIF (Task 4.1 y 4.2) — tests de comportamiento.

Verifica que _gif_pipeline:
  - Detecta cache hits (archivo existe y tiene contenido) y NO llama a build_gif_fn
  - Detecta cache misses (archivo no existe o está vacío) y SÍ llama a build_gif_fn
  - Devuelve la estructura de respuesta correcta en ambos casos

Usa Flask test client con mocks de GEE para evitar dependencias externas.

Nota: Los mock paths usan 'routes.gif_routes.*' (no 'gee.ndvi.*') porque
gif_routes importa las funciones con 'from X import Y', y hay que patchear
la referencia en el módulo que la usa, no en el módulo de origen.
"""

import json
from unittest.mock import MagicMock, patch

import pytest

# Bbox de prueba pequeño (≤ 8° por lado) que pasa validación de BBoxSchema
SMALL_BBOX_URL = "[-92.0,17.0,-91.0,18.0]"
NDVI_ENDPOINT = "/api/ndvi-gif-bbox?start=2020-01-01&end=2020-12-31"


# ---------------------------------------------------------------------------
# Fixtures
# ---------------------------------------------------------------------------


@pytest.fixture
def client():
    """Cliente de test Flask con app real."""
    from app import app
    app.config["TESTING"] = True
    return app.test_client()


@pytest.fixture
def sample_dates():
    """Fechas y valores de timeseries de prueba."""
    return ["2020-01-01", "2020-02-01", "2020-03-01"], [0.5, 0.6, 0.7]


def _make_cache_hit_mocks(sample_dates):
    """
    Crea mocks para simular un cache HIT:
      - GIFS_DIR / filename → mock_file (exists=True, st_size=1024)
      - build_ts_fn → retorna sample_dates
      - build_gif_fn → retorna URL (no debería ser llamado)
    """
    mock_dir = MagicMock()
    mock_file = MagicMock()
    mock_file.exists.return_value = True
    mock_file.stat.return_value.st_size = 1024
    mock_dir.__truediv__ = MagicMock(return_value=mock_file)

    mock_build_gif = MagicMock(return_value="https://ee.google.com/test.gif")
    mock_build_ts = MagicMock(return_value=sample_dates)

    return mock_dir, mock_file, mock_build_gif, mock_build_ts


def _make_cache_miss_mocks(sample_dates):
    """
    Crea mocks para simular un cache MISS:
      - GIFS_DIR / filename → mock_file (exists=False)
      - build_ts_fn → retorna sample_dates
      - build_gif_fn → retorna URL
    """
    mock_dir = MagicMock()
    mock_file = MagicMock()
    mock_file.exists.return_value = False
    mock_dir.__truediv__ = MagicMock(return_value=mock_file)

    mock_build_gif = MagicMock(return_value="https://ee.google.com/test.gif")
    mock_build_ts = MagicMock(return_value=sample_dates)
    mock_add = MagicMock(return_value=None)

    return mock_dir, mock_file, mock_build_gif, mock_build_ts, mock_add


# ---------------------------------------------------------------------------
# Tests de cache hit
# ---------------------------------------------------------------------------


class TestGifPipelineCacheHit:
    """
    Task 4.1: Verifica que en cache hit:
      - build_gif_fn NO se llama
      - build_ts_fn SÍ se llama para obtener datos
      - Se devuelve la respuesta con gifUrl apuntando al archivo existente
    """

    def test_cache_hit_does_not_call_build_gif_fn(self, client, sample_dates):
        """Cache hit: build_gif_fn NO debe ser llamado cuando el archivo existe."""
        mock_dir, _, mock_build_gif, mock_build_ts = _make_cache_hit_mocks(sample_dates)

        with patch("routes.gif_routes.build_ndvi_gif_bbox", mock_build_gif), \
             patch("routes.gif_routes.build_ndvi_timeseries_bbox", mock_build_ts), \
             patch("routes.gif_routes.add_dates_to_gif"), \
             patch("routes.gif_routes.GIFS_DIR", mock_dir):

            client.get(f"{NDVI_ENDPOINT}&bbox={SMALL_BBOX_URL}")

            mock_build_gif.assert_not_called()

    def test_cache_hit_calls_build_ts_fn(self, client, sample_dates):
        """Cache hit: build_ts_fn DEBE ser llamado para obtener datos de respuesta."""
        mock_dir, _, mock_build_gif, mock_build_ts = _make_cache_hit_mocks(sample_dates)

        with patch("routes.gif_routes.build_ndvi_gif_bbox", mock_build_gif), \
             patch("routes.gif_routes.build_ndvi_timeseries_bbox", mock_build_ts), \
             patch("routes.gif_routes.add_dates_to_gif"), \
             patch("routes.gif_routes.GIFS_DIR", mock_dir):

            client.get(f"{NDVI_ENDPOINT}&bbox={SMALL_BBOX_URL}")

            mock_build_ts.assert_called_once()

    def test_cache_hit_returns_correct_response_structure(self, client, sample_dates):
        """Cache hit: la respuesta debe tener gifUrl, bbox, dates y valores."""
        mock_dir, _, mock_build_gif, mock_build_ts = _make_cache_hit_mocks(sample_dates)

        with patch("routes.gif_routes.build_ndvi_gif_bbox", mock_build_gif), \
             patch("routes.gif_routes.build_ndvi_timeseries_bbox", mock_build_ts), \
             patch("routes.gif_routes.add_dates_to_gif"), \
             patch("routes.gif_routes.GIFS_DIR", mock_dir):

            response = client.get(f"{NDVI_ENDPOINT}&bbox={SMALL_BBOX_URL}")
            data = json.loads(response.get_data(as_text=True))

            assert response.status_code == 200
            assert "gifUrl" in data
            assert "bbox" in data
            assert "dates" in data
            assert "ndvi" in data

    def test_cache_hit_returns_existing_file_url(self, client, sample_dates):
        """Cache hit: gifUrl debe apuntar al archivo existente."""
        mock_dir, _, mock_build_gif, mock_build_ts = _make_cache_hit_mocks(sample_dates)

        with patch("routes.gif_routes.build_ndvi_gif_bbox", mock_build_gif), \
             patch("routes.gif_routes.build_ndvi_timeseries_bbox", mock_build_ts), \
             patch("routes.gif_routes.add_dates_to_gif"), \
             patch("routes.gif_routes.GIFS_DIR", mock_dir):

            response = client.get(f"{NDVI_ENDPOINT}&bbox={SMALL_BBOX_URL}")
            data = json.loads(response.get_data(as_text=True))

            assert "/static/gifs/" in data["gifUrl"]
            assert data["gifUrl"].endswith(".gif")

    def test_cache_hit_with_empty_file_falls_through_to_miss(self, client, sample_dates):
        """Cache hit con archivo vacío (0 bytes) debe caer al path de cache miss."""
        mock_dir = MagicMock()
        mock_file = MagicMock()
        mock_file.exists.return_value = True
        mock_file.stat.return_value.st_size = 0  # Archivo vacío
        mock_dir.__truediv__ = MagicMock(return_value=mock_file)

        mock_build_gif = MagicMock(return_value="https://ee.google.com/test.gif")
        mock_build_ts = MagicMock(return_value=sample_dates)
        mock_add = MagicMock(return_value=None)

        with patch("routes.gif_routes.build_ndvi_gif_bbox", mock_build_gif), \
             patch("routes.gif_routes.build_ndvi_timeseries_bbox", mock_build_ts), \
             patch("routes.gif_routes.add_dates_to_gif", mock_add), \
             patch("routes.gif_routes.GIFS_DIR", mock_dir):

            client.get(f"{NDVI_ENDPOINT}&bbox={SMALL_BBOX_URL}")

            # Si el archivo está vacío, build_gif_fn DEBE ser llamado (cache miss)
            mock_build_gif.assert_called_once()


# ---------------------------------------------------------------------------
# Tests de cache miss
# ---------------------------------------------------------------------------


class TestGifPipelineCacheMiss:
    """
    Task 4.2: Verifica que en cache miss:
      - build_gif_fn SÍ se llama
      - Se genera el archivo con add_dates_to_gif
      - Se devuelve la respuesta correcta
    """

    def test_cache_miss_calls_build_gif_fn(self, client, sample_dates):
        """Cache miss: build_gif_fn DEBE ser llamado cuando el archivo no existe."""
        mock_dir, _, mock_build_gif, mock_build_ts, mock_add = _make_cache_miss_mocks(sample_dates)

        with patch("routes.gif_routes.build_ndvi_gif_bbox", mock_build_gif), \
             patch("routes.gif_routes.build_ndvi_timeseries_bbox", mock_build_ts), \
             patch("routes.gif_routes.add_dates_to_gif", mock_add), \
             patch("routes.gif_routes.GIFS_DIR", mock_dir):

            client.get(f"{NDVI_ENDPOINT}&bbox={SMALL_BBOX_URL}")

            # Verificar que build_gif_fn fue llamado
            mock_build_gif.assert_called_once()

    def test_cache_miss_calls_add_dates_to_gif(self, client, sample_dates):
        """Cache miss: add_dates_to_gif DEBE ser llamado para generar el archivo."""
        mock_dir, _, mock_build_gif, mock_build_ts, mock_add = _make_cache_miss_mocks(sample_dates)

        with patch("routes.gif_routes.build_ndvi_gif_bbox", mock_build_gif), \
             patch("routes.gif_routes.build_ndvi_timeseries_bbox", mock_build_ts), \
             patch("routes.gif_routes.add_dates_to_gif", mock_add), \
             patch("routes.gif_routes.GIFS_DIR", mock_dir):

            client.get(f"{NDVI_ENDPOINT}&bbox={SMALL_BBOX_URL}")

            # Verificar que add_dates_to_gif fue llamado
            mock_add.assert_called_once()
"""
Tests de runtime para la paleta de flood risk con el SDK real instalado.

Los mocks de conftest ocultan rasterio/matplotlib, así que cada caso corre en
un subproceso frío con el SDK real (matplotlib/rasterio/numpy instalados),
un GeoTIFF sintético 4x4, EE falsificado (stub) y todos los artefactos
(MPLCONFIGDIR/HOME/TMPDIR/salida) dentro de .cache de este worktree.
"""

import json
import os
import subprocess
import sys
from pathlib import Path

from PIL import Image

ROOT = Path(__file__).resolve().parents[2]
SCENARIO_ROOT = ROOT / ".cache" / "flood-palette-runtime" / "pytest"

# GeoTIFF sintético 4x4: valores FHI 0-110, nodata=-9999 en (3,0) y (0,1).
_COLD_PROBE = """
import hashlib, json, sys
from pathlib import Path
from unittest.mock import MagicMock

sys.path.insert(0, __import__("os").environ["PALETTE_PROBE_ROOT"])

import config

base = Path(config.BASE_DIR)
flood_maps = config.FLOOD_MAPS_DIR
flood_maps.mkdir(parents=True, exist_ok=True)
config.DATA_DIR.mkdir(parents=True, exist_ok=True)
sentinel = flood_maps / "sentinel_probe.bin"
if not sentinel.exists():
    sentinel.write_bytes(b"palette-sentinel")

tif_path = config.DATA_DIR / "fhi_centla_100m.tif"
if not tif_path.exists():
    import numpy as np
    import rasterio
    from rasterio.transform import from_origin
    arr = np.array(
        [[0, 20, 40, 60], [80, 100, 110, -9999], [-9999, 10, 55, 95], [5, 35, 65, 85]],
        dtype=np.float32,
    )
    with rasterio.open(
        tif_path, "w", driver="GTiff", height=4, width=4, count=1, dtype="float32",
        nodata=-9999.0, transform=from_origin(-92.0, 18.0, 0.01, 0.01), crs="EPSG:4326",
    ) as dst:
        dst.write(arr, 1)

palette = sys.argv[1]
mode = sys.argv[2]


def snapshot():
    return {
        str(p.relative_to(base)): hashlib.sha256(p.read_bytes()).hexdigest()
        for p in sorted(base.rglob("*")) if p.is_file()
    }


before = snapshot()
try:
    if mode == "route":
        sys.modules["ee"] = MagicMock()
        import app as app_module
        app_module.app.config["INITIALIZE_RUNTIME"] = False
        client = app_module.app.test_client()
        from urllib.parse import quote
        resp = client.get(
            f"/api/flood-risk-municipio?muni=centla&palette={quote(palette)}"
        )
        result = {"status": resp.status_code, "body": resp.get_json()}
    else:
        from backend.gee.flood_risk import render_flood_risk_png
        url, bbox = render_flood_risk_png(tif_path, palette)
        png_rel = str((flood_maps / Path(url).name).relative_to(base))
        result = {"ok": True, "url": url, "bbox": list(bbox), "png": png_rel}
except Exception as exc:
    result = {"ok": False, "error_type": type(exc).__name__, "error": str(exc)}
after = snapshot()
print(json.dumps({"result": result, "before": before, "after": after}))
"""


def _run_cold(tmp_path: Path, palette: str, mode: str) -> dict:
    """Corre la sonda fría con SDK real; todos los artefactos bajo .cache."""
    for name in ("base", "home", "mplconfig", "tmp"):
        (tmp_path / name).mkdir(parents=True, exist_ok=True)
    script = tmp_path / "cold_probe.py"
    script.write_text(_COLD_PROBE, encoding="utf-8")
    env = dict(os.environ)
    env.update(
        {
            "BASE_DIR_OVERRIDE": str(tmp_path / "base"),
            "MPLCONFIGDIR": str(tmp_path / "mplconfig"),
            "HOME": str(tmp_path / "home"),
            "TMPDIR": str(tmp_path / "tmp"),
            "RATE_LIMIT_ENABLED": "false",
            "PALETTE_PROBE_ROOT": str(ROOT),
        }
    )
    proc = subprocess.run(
        [sys.executable, str(script), palette, mode],
        cwd=tmp_path,
        env=env,
        capture_output=True,
        text=True,
        timeout=240,
    )
    assert proc.returncode == 0, f"cold probe failed:\n{proc.stderr}"
    return json.loads(proc.stdout.strip().splitlines()[-1])


def test_gee_flood_route_renders_default_palette_and_reuses_cache(tmp_path):
    """Regresión: paleta por defecto funciona y reutiliza el PNG cacheado."""
    data = _run_cold(tmp_path, "gee_flood", "route")
    assert data["result"]["status"] == 200
    assert data["result"]["body"] == {
        "mapUrl": "/static/flood_maps/floodrisk_fhi_centla_100m_gee_flood.png",
        "bbox": [-92.0, 17.96, -91.96, 18.0],
    }
    assert "frontend/static/flood_maps/floodrisk_fhi_centla_100m_gee_flood.png" in data["after"]
    # Segunda llamada: misma URL y ningún archivo nuevo (reuso del cache antiguo).
    data2 = _run_cold(tmp_path, "gee_flood", "route")
    assert data2["result"] == data["result"]
    assert data2["after"] == data2["before"]


def test_valid_matplotlib_palette_route_renders(tmp_path):
    """Paleta matplotlib válida debe renderizar por la ruta pública."""
    data = _run_cold(tmp_path, "viridis", "route")
    assert data["result"]["status"] == 200
    assert data["result"]["body"] == {
        "mapUrl": "/static/flood_maps/floodrisk_fhi_centla_100m_viridis.png",
        "bbox": [-92.0, 17.96, -91.96, 18.0],
    }
    assert "frontend/static/flood_maps/floodrisk_fhi_centla_100m_viridis.png" in data["after"]


def test_invalid_palette_route_rejected_without_side_effects(tmp_path):
    """Paleta inválida: 500 con formato existente y cero efectos en archivos."""
    data = _run_cold(tmp_path, "not_a_colormap", "route")
    assert data["result"]["status"] == 500
    assert data["result"]["body"] == {
        "error": "Error interno al generar el mapa de riesgo."
    }
    assert data["after"] == data["before"]


def test_traversal_palette_creates_nothing_outside_output(tmp_path):
    """Evidencia: paleta con forma de traversal no crea archivos ni directorios
    fuera de la salida configurada (el fallo ocurre antes de calcular ruta)."""
    palette = "../../palette_escape_probe"
    data = _run_cold(tmp_path, palette, "route")
    assert data["result"]["status"] == 500
    assert data["result"]["body"] == {
        "error": "Error interno al generar el mapa de riesgo."
    }
    assert data["after"] == data["before"]
    base = tmp_path / "base"
    would_be = (
        base / "frontend" / "static" / "flood_maps" / f"floodrisk_fhi_centla_100m_{palette}.png"
    )
    target = would_be.resolve()
    assert ROOT / ".cache" in target.parents  # la sonda nunca sale de .cache
    assert not target.exists()


def test_valid_matplotlib_palette_direct_renders(tmp_path):
    """render_flood_risk_png con SDK real: 'viridis' genera PNG RGBA correcto."""
    data = _run_cold(tmp_path, "viridis", "direct")
    assert data["result"]["ok"] is True, data["result"]
    assert data["result"]["url"] == (
        "/static/flood_maps/floodrisk_fhi_centla_100m_viridis.png"
    )
    assert data["result"]["bbox"] == [-92.0, 17.96, -91.96, 18.0]
    png = tmp_path / "base" / data["result"]["png"]
    with Image.open(png) as img:
        assert img.size == (4, 4)
        assert img.mode == "RGBA"
        pixels = img.load()
        assert pixels[0, 0] == (68, 1, 84, 255)  # viridis(0.0)
        assert pixels[3, 1][3] == 0  # pixel nodata (fila 1, col 3) transparente


def test_gee_flood_direct_renders_default_palette(tmp_path):
    """Regresión: paleta gee_flood conserva sus colores exactos con SDK real."""
    data = _run_cold(tmp_path, "gee_flood", "direct")
    assert data["result"]["ok"] is True, data["result"]
    png = tmp_path / "base" / data["result"]["png"]
    with Image.open(png) as img:
        assert img.size == (4, 4)
        assert img.mode == "RGBA"
        pixels = img.load()
        assert pixels[0, 0] == (46, 204, 113, 255)  # #2ecc71
        assert pixels[3, 1][3] == 0  # pixel nodata (fila 1, col 3) transparente

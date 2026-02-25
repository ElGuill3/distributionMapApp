"""
Módulo para renderizado de mapas de riesgo de inundación (FHI).

Los mapas se generan a partir de GeoTIFFs locales (no GEE) usando
rasterio + matplotlib para colorizar y PIL para exportar como PNG transparente.

Paleta FHI (Flood Hazard Index):
  0–20  → Verde      (#2ecc71) — Muy bajo
  20–40 → Verde claro (#a5d66d) — Bajo
  40–60 → Amarillo   (#ffeb3b) — Moderado
  60–80 → Naranja    (#ff9800) — Alto
  80–100→ Rojo       (#f44336) — Muy alto
  >100  → Rojo oscuro(#b71c1c) — Crítico
"""
from pathlib import Path

import numpy as np
import rasterio
from matplotlib import cm
from matplotlib.colors import LinearSegmentedColormap, Normalize
from PIL import Image as PILImage

from config import FLOOD_MAPS_DIR


# Colores en formato hex para la paleta FHI (mismos que GEE)
_FHI_COLORS_HEX = [
    '#2ecc71',
    '#a5d66d',
    '#ffeb3b',
    '#ff9800',
    '#f44336',
    '#b71c1c',
]


def create_gee_flood_colormap() -> LinearSegmentedColormap:
    """
    Crea el colormap de matplotlib equivalente a la paleta FHI usada en GEE.

    Returns:
        LinearSegmentedColormap con 256 colores.
    """
    colors_rgb = []
    for hex_color in _FHI_COLORS_HEX:
        h = hex_color.lstrip('#')
        rgb = tuple(int(h[i:i+2], 16) / 255.0 for i in (0, 2, 4))
        colors_rgb.append(rgb)
    return LinearSegmentedColormap.from_list('gee_flood', colors_rgb, N=256)


def render_flood_risk_png(
    tif_path: Path,
    palette: str = 'gee_flood',
) -> tuple[str, list[float]]:
    """
    Genera un PNG con transparencia (RGBA) a partir de un GeoTIFF de riesgo FHI.

    El archivo se guarda en FLOOD_MAPS_DIR con nombre
    ``floodrisk_<stem>_<palette>.png``.

    Args:
        tif_path : Ruta al GeoTIFF de entrada.
        palette  : Nombre de la paleta. 'gee_flood' usa la paleta FHI
                   personalizada; cualquier otro valor se interpreta como
                   nombre de colormap de matplotlib.

    Returns:
        Tupla (url_relativa, bbox) donde bbox = [minLon, minLat, maxLon, maxLat].

    Raises:
        ValueError: si tif_path no existe.
    """
    if not tif_path.exists():
        raise ValueError(f"No se encontró el archivo: {tif_path}")

    with rasterio.open(tif_path) as src:
        arr    = src.read(1).astype(float)
        nodata = src.nodata
        bounds = src.bounds

    if nodata is not None:
        arr[arr == nodata] = np.nan

    if palette == 'gee_flood':
        cmap = create_gee_flood_colormap()
        vmin, vmax = 0.0, 100.0
    else:
        cmap = cm.get_cmap(palette)
        vmin = float(np.nanmin(arr))
        vmax = float(np.nanmax(arr))

    norm    = Normalize(vmin=vmin, vmax=vmax)
    rgba    = cmap(norm(arr))
    img_arr = (rgba * 255).astype(np.uint8)

    # Hacer transparentes los píxeles sin datos
    nan_mask          = np.isnan(arr)
    img_arr[nan_mask, 3] = 0

    out_name = f"floodrisk_{tif_path.stem}_{palette}.png"
    out_path = FLOOD_MAPS_DIR / out_name
    PILImage.fromarray(img_arr, mode='RGBA').save(out_path)

    map_url = f"/static/flood_maps/{out_name}"
    bbox    = [bounds.left, bounds.bottom, bounds.right, bounds.top]

    return map_url, bbox

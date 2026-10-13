"""Publish the susceptibility map for the web app.

The continuous ensemble score is cut into five state-relative classes (equal
area quintiles), rendered as paletted XYZ PNG tiles in Web Mercator and
summarised per municipality. Everything is static: the app only serves files.
"""

from __future__ import annotations

import json
import math
import shutil
import tempfile
from datetime import date
from pathlib import Path

import numpy as np
import rasterio
import rasterio.windows
from PIL import Image
from rasterio.enums import Resampling
from rasterio.features import rasterize
from rasterio.transform import from_bounds
from rasterio.vrt import WarpedVRT
from rasterio.warp import transform_bounds

from backend.floodmodel import model

HALF_WORLD = 20037508.342789244
TILE_SIZE = 256
CLASS_NODATA = 0
# ColorBrewer YlGnBu (5 classes): ordinal, colour-blind and print safe.
PALETTE = {
    0: (0, 0, 0),
    1: (255, 255, 204),
    2: (161, 218, 180),
    3: (65, 182, 196),
    4: (44, 127, 184),
    5: (37, 52, 148),
}
CLASS_LABELS = {1: "Muy baja", 2: "Baja", 3: "Media", 4: "Alta", 5: "Muy alta"}
# Quintile edges of the score: four breaks split valid cells into five
# equal-area classes (class = number of breaks below the value + 1).
CLASS_PERCENTILES = [20, 40, 60, 80]
# Classes counted as "high susceptibility" in municipality stats (Alta, Muy alta).
HIGH_CLASSES = (4, 5)
# Switch from nearest to mode resampling once a tile pixel spans more than
# this many source cells. Tile pixels are Web Mercator metres, which at
# Tabasco's latitude (~18 N) are ~5 % larger than ground metres; the margin
# absorbs that.
MODE_RESAMPLING_RATIO = 1.5
SOURCES = [
    "INEGI, Modelo Digital de Elevación LiDAR 5 m (2007-2012)",
    "INEGI, Continuo de Elevaciones Mexicano 3.0, 15 m (relleno de huecos LiDAR)",
    "CENAPRED, Atlas Nacional de Riesgos: inundaciones 2011 y 2020",
    "Copernicus Sentinel-1 (ESA), procesado en Google Earth Engine",
    "JRC/CEMS GloFAS Flood Hazard v2.1 (periodo de retorno 100 años)",
    "MERIT Hydro (Yamazaki et al., 2019)",
    "JRC Global Surface Water v1.4 (Pekel et al., 2016)",
    "ESA WorldCover 2021 v200",
    "FAO GAUL 2025 (límites municipales)",
]


def classify(score: Path, output: Path) -> tuple[Path, list[float]]:
    """Quintile classes 1-5 over valid cells; 0 where there is no score."""
    with rasterio.open(score) as src:
        values = model._as_nan(src.read(1), src.nodata)
        profile = src.profile.copy()
    valid = np.isfinite(values)
    if not valid.any():
        raise ValueError(f"{score.name} has no valid cells to classify")
    breaks = [float(b) for b in np.percentile(values[valid], CLASS_PERCENTILES)]
    classes = np.zeros(values.shape, dtype="uint8")
    # digitize returns how many breaks lie below each value (0-4) -> class 1-5.
    classes[valid] = (np.digitize(values[valid], breaks) + 1).astype("uint8")
    model._write_single(output, profile, classes, dtype="uint8", nodata=CLASS_NODATA)
    return output, breaks


def tile_bounds(z: int, x: int, y: int) -> tuple[float, float, float, float]:
    """Web Mercator bounds (left, bottom, right, top) of an XYZ tile."""
    size = 2 * HALF_WORLD / 2**z
    left = -HALF_WORLD + x * size
    top = HALF_WORLD - y * size
    return left, top - size, left + size, top


def _tile_xy(lon: float, lat: float, z: int) -> tuple[int, int]:
    n = 2**z
    x = math.floor((lon + 180.0) / 360.0 * n)
    lat_rad = math.radians(lat)
    y = math.floor((1.0 - math.asinh(math.tan(lat_rad)) / math.pi) / 2.0 * n)
    return min(max(x, 0), n - 1), min(max(y, 0), n - 1)


def tiles_for_bounds(bounds: tuple, z: int) -> list[tuple[int, int]]:
    """Tiles covering a (west, south, east, north) box in degrees."""
    west, south, east, north = bounds
    x0, y0 = _tile_xy(west, north, z)
    x1, y1 = _tile_xy(east, south, z)
    return [(x, y) for x in range(x0, x1 + 1) for y in range(y0, y1 + 1)]


def _flat_palette() -> list[int]:
    flat = []
    for index in range(256):
        flat.extend(PALETTE.get(index, (0, 0, 0)))
    return flat


def write_tiles(classes: Path, out_dir: Path, *, zooms: list[int]) -> int:
    """Paletted PNG tiles ``{z}/{x}/{y}.png``; index 0 is transparent."""
    palette = _flat_palette()
    written = 0
    with rasterio.open(classes) as src:
        lonlat = transform_bounds(src.crs, "EPSG:4326", *src.bounds)
        for z in zooms:
            # Nearest keeps class edges crisp at native zoom; mode avoids
            # speckle when several cells fall in one tile pixel.
            pixel = 2 * HALF_WORLD / 2**z / TILE_SIZE
            resampling = (
                Resampling.mode
                if pixel > MODE_RESAMPLING_RATIO * src.res[0]
                else Resampling.nearest
            )
            for x, y in tiles_for_bounds(lonlat, z):
                left, bottom, right, top = tile_bounds(z, x, y)
                with WarpedVRT(
                    src,
                    crs="EPSG:3857",
                    transform=from_bounds(
                        left, bottom, right, top, TILE_SIZE, TILE_SIZE
                    ),
                    width=TILE_SIZE,
                    height=TILE_SIZE,
                    resampling=resampling,
                    nodata=CLASS_NODATA,
                ) as vrt:
                    data = vrt.read(1)
                image = Image.frombytes("P", (TILE_SIZE, TILE_SIZE), data.tobytes())
                image.putpalette(palette)
                path = out_dir / str(z) / str(x) / f"{y}.png"
                path.parent.mkdir(parents=True, exist_ok=True)
                image.save(path, optimize=True, transparency=0)
                written += 1
    return written


def municipality_stats(
    classes: Path, score: Path, boundaries: dict, *, crs: str = "EPSG:4326"
) -> dict:
    """Class shares, mean score, area and rank of every municipality."""
    features = boundaries["features"]
    with rasterio.open(classes) as src:
        cls = src.read(1)
        grid_crs, transform = src.crs, src.transform
        cell_km2 = abs(src.res[0] * src.res[1]) / 1e6
    with rasterio.open(score) as src:
        values = model._as_nan(src.read(1), src.nodata)
    geometries = model._project([f["geometry"] for f in features], crs, grid_crs)
    zone = rasterize(
        ((g, i + 1) for i, g in enumerate(geometries)),
        out_shape=cls.shape,
        transform=transform,
        fill=0,
        dtype="int32",
    )
    valid = (cls != CLASS_NODATA) & (zone > 0)
    n_zones = len(features) + 1
    counts = np.zeros((n_zones, 6), dtype="int64")
    np.add.at(counts, (zone[valid], cls[valid]), 1)
    scored = valid & np.isfinite(values)
    sums = np.bincount(zone[scored], weights=values[scored], minlength=n_zones)
    scored_n = np.bincount(zone[scored], minlength=n_zones)
    out = []
    for i, feature in enumerate(features, start=1):
        total = int(counts[i, 1:].sum())
        share = (counts[i, 1:] / total).tolist() if total else [0.0] * 5
        mean_score = round(float(sums[i] / scored_n[i]), 4) if scored_n[i] else None
        out.append(
            {
                "type": "Feature",
                "geometry": feature["geometry"],
                # Fixed published schema: only name and code come from the
                # boundary source; rank stays None without a score.
                "properties": {
                    "name": feature["properties"]["name"],
                    "code": feature["properties"]["code"],
                    "area_km2": round(total * cell_km2, 3),
                    "class_share": [round(s, 4) for s in share],
                    "high_share": round(sum(share[c - 1] for c in HIGH_CLASSES), 4),
                    "mean_score": mean_score,
                    "rank": None,
                },
            }
        )
    ranked = sorted(
        (f for f in out if f["properties"]["mean_score"] is not None),
        key=lambda f: -f["properties"]["mean_score"],
    )
    for rank, feature in enumerate(ranked, start=1):
        feature["properties"]["rank"] = rank
    return {"type": "FeatureCollection", "features": out}


def _round_coords(geometry: dict, digits: int = 5) -> dict:
    def walk(c):
        if isinstance(c[0], (int, float)):
            return [round(v, digits) for v in c]
        return [walk(x) for x in c]

    return {**geometry, "coordinates": walk(geometry["coordinates"])}


def publish(work_dir: Path, out_dir: Path, *, zooms=range(7, 13)) -> dict:
    """Classes, tiles, municipality stats and metadata into ``out_dir``.

    Everything is built in a temporary sibling directory and swapped in at the
    end, so the served directory is never half-written and tiles from a
    previous zoom set do not linger. On failure ``out_dir`` is left as it was.
    """
    score = work_dir / "model" / "susceptibility_30m.tif"
    boundaries_path = work_dir / "boundaries" / "municipalities.geojson"
    if not score.exists():
        raise FileNotFoundError(f"{score} is missing: run the `final` step first")
    if not boundaries_path.exists():
        raise FileNotFoundError(
            f"{boundaries_path} is missing: run the `boundaries` step first"
        )
    out_dir.parent.mkdir(parents=True, exist_ok=True)
    staging = Path(tempfile.mkdtemp(prefix=f".{out_dir.name}-", dir=out_dir.parent))
    try:
        result = _build(work_dir, staging, score, boundaries_path, list(zooms))
        previous = out_dir.with_name(f".{out_dir.name}-previous")
        shutil.rmtree(previous, ignore_errors=True)
        if out_dir.exists():
            out_dir.rename(previous)
        staging.rename(out_dir)
        shutil.rmtree(previous, ignore_errors=True)
    finally:
        shutil.rmtree(staging, ignore_errors=True)
    return {**result, "out_dir": str(out_dir)}


def _build(
    work_dir: Path, out_dir: Path, score: Path, boundaries_path: Path, zooms: list
) -> dict:
    classes, breaks = classify(score, work_dir / "model" / "classes_30m.tif")
    n_tiles = write_tiles(classes, out_dir / "tiles", zooms=zooms)
    boundaries = json.loads(boundaries_path.read_text())
    stats = municipality_stats(classes, score, boundaries)
    for feature in stats["features"]:
        feature["geometry"] = _round_coords(feature["geometry"])
    (out_dir / "municipalities.geojson").write_text(
        json.dumps(stats, ensure_ascii=False, separators=(",", ":"))
    )
    with rasterio.open(classes) as src:
        west, south, east, north = transform_bounds(src.crs, "EPSG:4326", *src.bounds)
    validation_path = work_dir / "model" / "validation.json"
    validation = (
        json.loads(validation_path.read_text()) if validation_path.exists() else None
    )
    metadata = {
        "title": "Susceptibilidad a inundación de Tabasco",
        "generated": date.today().isoformat(),
        "description": (
            "Índice relativo al estado: promedio de rangos de un modelo de eventos "
            "extremos (CENAPRED), un modelo de inundación estacional (Sentinel-1) y la "
            "profundidad JRC para 100 años. No es profundidad ni probabilidad."
        ),
        "classes": [
            {
                "value": v,
                "label": CLASS_LABELS[v],
                "color": "#{:02x}{:02x}{:02x}".format(*PALETTE[v]),
            }
            for v in range(1, 6)
        ],
        "score_breaks": breaks,
        "tiles": {
            "url": "tiles/{z}/{x}/{y}.png",
            "minzoom": min(zooms),
            "maxzoom": max(zooms),
        },
        "bounds": [west, south, east, north],
        "sources": SOURCES,
        "validation": validation["scores"] if validation else None,
    }
    (out_dir / "metadata.json").write_text(
        json.dumps(metadata, ensure_ascii=False, indent=2)
    )
    return {"tiles": n_tiles, "breaks": breaks}

"""Earth Engine feature layers on the model grid (chunked computePixels).

Layers (all public, credited in the README):
  * JRC Global River Flood Hazard Maps v2.1 — depth for 10/100-year floods;
  * MERIT Hydro — upstream drainage area (includes basins outside Tabasco);
  * JRC Global Surface Water — water occurrence and maximum extent;
  * ESA WorldCover v200 — land cover class.
"""

from __future__ import annotations

import math
from collections.abc import Callable, Iterator
from dataclasses import dataclass
from pathlib import Path

import numpy as np
import rasterio
import rasterio.windows
from rasterio.transform import from_origin

NODATA = -9999.0
FEATURE_BANDS = [
    "jrc_depth_rp10",
    "jrc_depth_rp100",
    "merit_upa_km2",
    "merit_hand",
    "gsw_occurrence",
    "gsw_max_extent",
    "worldcover",
]


@dataclass(frozen=True)
class Grid:
    crs: str
    left: float
    top: float
    width: int
    height: int
    res: float

    @classmethod
    def from_raster(cls, path: Path, *, res: float) -> Grid:
        with rasterio.open(path) as src:
            bounds = src.bounds
            crs = src.crs.to_string()
        width = math.ceil((bounds.right - bounds.left) / res)
        height = math.ceil((bounds.top - bounds.bottom) / res)
        return cls(crs, bounds.left, bounds.top, width, height, float(res))

    def windows(self, *, chunk: int) -> Iterator[tuple[int, int, int, int]]:
        for row in range(0, self.height, chunk):
            for col in range(0, self.width, chunk):
                height = min(chunk, self.height - row)
                yield row, col, height, min(chunk, self.width - col)

    def request(self, row: int, col: int, height: int, width: int) -> dict:
        return {
            "dimensions": {"width": width, "height": height},
            "affineTransform": {
                "scaleX": self.res,
                "shearX": 0,
                "translateX": self.left + col * self.res,
                "shearY": 0,
                "scaleY": -self.res,
                "translateY": self.top - row * self.res,
            },
            "crsCode": self.crs,
        }


AUX_BANDS = ["merit_elv", "gsw_occurrence", "merit_upa_km2"]


def aux_image():
    """Layers used to condition the LiDAR DEM (gap fill, water, rivers)."""
    import ee

    merit = ee.Image("MERIT/Hydro/v1_0_1")
    gsw = ee.Image("JRC/GSW1_4/GlobalSurfaceWater")
    return ee.Image.cat(
        [
            merit.select("elv").rename("merit_elv"),
            gsw.select("occurrence").unmask(0).rename("gsw_occurrence"),
            merit.select("upa").unmask(0).rename("merit_upa_km2"),
        ]
    ).toFloat()


def feature_image():
    """Build the multi-band Earth Engine image with ``FEATURE_BANDS``."""
    import ee

    hazard = ee.ImageCollection("JRC/CEMS_GLOFAS/FloodHazard/v2_1").mosaic()
    merit = ee.Image("MERIT/Hydro/v1_0_1")
    gsw = ee.Image("JRC/GSW1_4/GlobalSurfaceWater")
    worldcover = ee.ImageCollection("ESA/WorldCover/v200").first()
    return ee.Image.cat(
        [
            hazard.select("RP10_depth").unmask(0).rename("jrc_depth_rp10"),
            hazard.select("RP100_depth").unmask(0).rename("jrc_depth_rp100"),
            merit.select("upa").rename("merit_upa_km2"),
            merit.select("hnd").rename("merit_hand"),
            gsw.select("occurrence").unmask(0).rename("gsw_occurrence"),
            gsw.select("max_extent").unmask(0).rename("gsw_max_extent"),
            worldcover.select("Map").rename("worldcover"),
        ]
    ).toFloat()


def ee_compute(image) -> Callable[[dict, list[str]], np.ndarray]:
    """Return a ``compute(grid_request, bands)`` backed by ``ee.data.computePixels``."""
    import ee

    def compute(grid_request: dict, bands: list[str]) -> np.ndarray:
        request = {
            "expression": image.select(bands),
            "fileFormat": "NUMPY_NDARRAY",
            "grid": grid_request,
        }
        result = ee.data.computePixels(request)
        return np.stack([result[name] for name in bands], axis=-1).astype("float32")

    return compute


# computePixels rejects requests above 48 MiB; keep a margin for overhead.
MAX_REQUEST_BYTES = 40 * 1024 * 1024


def auto_chunk(n_bands: int, *, largest: int = 1024) -> int:
    """Largest power-of-two block whose float32 request fits the limit."""
    chunk = largest
    while chunk > 64 and chunk * chunk * n_bands * 4 > MAX_REQUEST_BYTES:
        chunk //= 2
    return chunk


def download(
    compute: Callable[[dict, list[str]], np.ndarray],
    bands: list[str],
    grid: Grid,
    output: Path,
    *,
    chunk: int | None = None,
) -> Path:
    """Fetch ``bands`` chunk by chunk, writing each block straight to disk."""
    chunk = chunk or auto_chunk(len(bands))
    output.parent.mkdir(parents=True, exist_ok=True)
    profile = {
        "driver": "GTiff",
        "width": grid.width,
        "height": grid.height,
        "count": len(bands),
        "dtype": "float32",
        "crs": grid.crs,
        "transform": from_origin(grid.left, grid.top, grid.res, grid.res),
        "nodata": NODATA,
        "compress": "deflate",
        "BIGTIFF": "IF_SAFER",
    }
    partial = output.with_suffix(".part.tif")
    with rasterio.open(partial, "w", **profile) as dst:
        dst.descriptions = tuple(bands)
        for row, col, height, width in grid.windows(chunk=chunk):
            block = compute(grid.request(row, col, height, width), bands)
            window = rasterio.windows.Window(col, row, width, height)
            dst.write(np.moveaxis(block, -1, 0).astype("float32"), window=window)
    partial.replace(output)
    return output


BOUNDARIES_ASSET = "FAO/GAUL/2025/level2"


def boundaries_geojson(info: dict) -> dict:
    """Keep only the municipality name and GAUL code of each feature."""
    features = [
        {
            "type": "Feature",
            "properties": {
                "name": f["properties"]["GAUL2_NAME"],
                "code": f["properties"]["GAUL2_CODE"],
            },
            "geometry": f["geometry"],
        }
        for f in info["features"]
    ]
    return {"type": "FeatureCollection", "features": features}


def fetch_boundaries(state: str = "Tabasco", *, max_error_m: float = 20.0) -> dict:
    """Municipalities of ``state`` from FAO GAUL 2025, simplified, in WGS 84."""
    import ee

    collection = (
        ee.FeatureCollection(BOUNDARIES_ASSET)
        .filter(ee.Filter.eq("GAUL1_NAME", state))
        .map(lambda f: f.simplify(max_error_m))
    )
    return boundaries_geojson(collection.getInfo())


# Sentinel-1 change detection, calibrated against CENAPRED's 2020 polygons
# (IoU 0.35): dark in the wet season and darker than the same year's dry season.
S1_WET_MONTHS = ("06-01", "12-31")
S1_DRY_MONTHS = ("02-01", "05-31")
S1_WET_DB = -13.0
S1_DROP_DB = -1.5
S1_MAX_HAND_M = 20.0


def s1_season_image(years: list[int], region):
    """One 0/1 band per year: flooded during that year's wet season."""
    import ee

    def collection(start: str, end: str):
        return (
            ee.ImageCollection("COPERNICUS/S1_GRD")
            .filterBounds(region)
            .filterDate(start, end)
            .filter(ee.Filter.eq("instrumentMode", "IW"))
            .filter(ee.Filter.listContains("transmitterReceiverPolarisation", "VV"))
            .select("VV")
        )

    permanent = (
        ee.Image("JRC/GSW1_4/GlobalSurfaceWater").select("occurrence").unmask(0).gt(50)
    )
    hand = ee.Image("MERIT/Hydro/v1_0_1").select("hnd")
    bands = []
    for year in years:
        wet = (
            collection(f"{year}-{S1_WET_MONTHS[0]}", f"{year}-{S1_WET_MONTHS[1]}")
            .reduce(ee.Reducer.percentile([10]))
            .focalMedian(30, "circle", "meters")
        )
        dry = (
            collection(f"{year}-{S1_DRY_MONTHS[0]}", f"{year}-{S1_DRY_MONTHS[1]}")
            .median()
            .focalMedian(30, "circle", "meters")
        )
        flooded = (
            wet.lt(S1_WET_DB)
            .And(wet.subtract(dry).lt(S1_DROP_DB))
            .And(hand.lt(S1_MAX_HAND_M))
            .And(permanent.Not())
        )
        bands.append(flooded.unmask(0).rename(f"s1_{year}"))
    return ee.Image.cat(bands).toFloat()

"""Chunked Earth Engine downloads stitched onto the model grid."""

import numpy as np
import pytest
import rasterio

from backend.floodmodel import gee_layers

GRID = gee_layers.Grid(
    crs="EPSG:32615", left=1000.0, top=5000.0, width=7, height=5, res=30.0
)


def test_grid_windows_cover_every_cell_exactly_once():
    windows = list(GRID.windows(chunk=3))

    covered = np.zeros((GRID.height, GRID.width), dtype=int)
    for row, col, height, width in windows:
        covered[row : row + height, col : col + width] += 1
    assert (covered == 1).all()
    assert len(windows) == 2 * 3


def test_download_stitches_chunks_in_their_geographic_place(tmp_path):
    bands = ["a", "b"]
    seen = []

    def compute(grid_request, band_names):
        transform = grid_request["affineTransform"]
        dims = grid_request["dimensions"]
        seen.append(
            (
                transform["translateX"],
                transform["translateY"],
                dims["width"],
                dims["height"],
            )
        )
        col0 = int(round((transform["translateX"] - GRID.left) / GRID.res))
        row0 = int(round((GRID.top - transform["translateY"]) / GRID.res))
        rows = np.arange(row0, row0 + dims["height"])[:, None]
        cols = np.arange(col0, col0 + dims["width"])[None, :]
        cell = (rows * 100 + cols).astype("float32")
        return np.stack([cell, -cell], axis=-1)

    out = gee_layers.download(compute, bands, GRID, tmp_path / "features.tif", chunk=3)

    with rasterio.open(out) as src:
        assert src.count == 2
        assert src.descriptions == ("a", "b")
        assert src.crs.to_string() == "EPSG:32615"
        assert src.transform.c == GRID.left and src.transform.f == GRID.top
        a = src.read(1)
        expected = np.arange(5)[:, None] * 100 + np.arange(7)[None, :]
        np.testing.assert_array_equal(a, expected)
        np.testing.assert_array_equal(src.read(2), -expected)
    assert (GRID.left, GRID.top, 3, 3) in seen


def test_grid_from_dem_aligns_to_target_resolution(tmp_path):
    dem = tmp_path / "dem.tif"
    with rasterio.open(
        dem,
        "w",
        driver="GTiff",
        width=10,
        height=6,
        count=1,
        dtype="float32",
        crs="EPSG:32615",
        transform=rasterio.transform.from_origin(500, 900, 10, 10),
    ) as dst:
        dst.write(np.zeros((6, 10), "float32"), 1)

    grid = gee_layers.Grid.from_raster(dem, res=30)

    assert (grid.left, grid.top, grid.res) == (500, 900, 30)
    assert (grid.width, grid.height) == (4, 2)

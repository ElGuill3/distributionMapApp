"""Published flood susceptibility artifact: classes, XYZ tiles, municipality stats."""

import json
import math

import numpy as np
import pytest
import rasterio
from PIL import Image
from rasterio.transform import from_origin

pytest.importorskip("lightgbm", reason="floodmodel dependency group not installed")

from backend.floodmodel import publish  # noqa: E402

UTM15 = "EPSG:32615"
NODATA = -9999.0


def _write(path, array, x0, y0, res, nodata=NODATA, dtype="float32", crs=UTM15):
    with rasterio.open(
        path,
        "w",
        driver="GTiff",
        width=array.shape[1],
        height=array.shape[0],
        count=1,
        dtype=dtype,
        crs=crs,
        transform=from_origin(x0, y0, res, res),
        nodata=nodata,
    ) as dst:
        dst.write(array.astype(dtype), 1)
    return path


def test_classify_splits_valid_cells_into_equal_area_quintiles(tmp_path):
    score = np.arange(100, dtype="float32").reshape(10, 10) / 100
    score[0, 0] = NODATA
    _write(tmp_path / "score.tif", score, 0, 100, 10)

    out, breaks = publish.classify(tmp_path / "score.tif", tmp_path / "classes.tif")

    with rasterio.open(out) as src:
        classes = src.read(1)
        assert src.nodata == 0
    assert classes[0, 0] == 0
    counts = np.bincount(classes.ravel(), minlength=6)
    assert counts[0] == 1
    assert all(19 <= c <= 20 for c in counts[1:])  # 99 valid cells in 5 classes
    assert len(breaks) == 4 and breaks == sorted(breaks)
    # Higher score never gets a lower class.
    flat = score.ravel()[1:], classes.ravel()[1:]
    assert np.all(np.diff(flat[1][np.argsort(flat[0])]) >= 0)


def test_tile_bounds_match_web_mercator():
    half = 20037508.342789244
    assert publish.tile_bounds(0, 0, 0) == pytest.approx((-half, -half, half, half))
    left, bottom, right, top = publish.tile_bounds(1, 1, 0)
    assert (left, bottom, right, top) == pytest.approx((0, 0, half, half))


def test_tiles_covering_a_lonlat_box():
    tiles = publish.tiles_for_bounds((-93.0, 17.5, -92.0, 18.5), 8)
    xs = {x for x, _ in tiles}
    ys = {y for _, y in tiles}
    # lon -93 at z8 -> x = floor((-93 + 180) / 360 * 256) = 61
    assert min(xs) == 61 and max(xs) == math.floor((-92 + 180) / 360 * 256)
    assert len(tiles) == len(xs) * len(ys)


def test_write_tiles_paints_each_class_with_its_palette_colour(tmp_path):
    # 2 km x 2 km square of class 5 on the left, class 1 on the right, in UTM.
    classes = np.zeros((200, 200), dtype="uint8")
    classes[:, :100] = 5
    classes[:, 100:] = 1
    x0, y0 = 500000.0, 2000000.0  # ~ -93.0, 18.09
    _write(tmp_path / "classes.tif", classes, x0, y0, 10, nodata=0, dtype="uint8")

    written = publish.write_tiles(tmp_path / "classes.tif", tmp_path / "tiles", zooms=[12])

    assert written >= 1
    png = sorted((tmp_path / "tiles" / "12").glob("*/*.png"))
    assert png
    colours = set()
    for path in png:
        img = Image.open(path)
        assert img.mode == "P"
        assert img.info.get("transparency") == 0
        colours |= {int(v) for v in np.unique(np.asarray(img))}
    assert colours <= {0, 1, 5}
    assert {1, 5} <= colours
    palette = Image.open(png[0]).getpalette()[: 3 * 6]
    assert tuple(palette[15:18]) == publish.PALETTE[5]


def test_municipality_stats_report_class_shares_and_mean_score(tmp_path):
    classes = np.array([[1, 1, 5, 5], [2, 2, 5, 0]], dtype="uint8")
    score = np.array([[0.1, 0.1, 0.9, 0.9], [0.3, 0.3, 0.9, NODATA]], dtype="float32")
    x0, y0, res = 500000.0, 2000000.0, 1000.0
    _write(tmp_path / "classes.tif", classes, x0, y0, res, nodata=0, dtype="uint8")
    _write(tmp_path / "score.tif", score, x0, y0, res)
    west = [[x0, y0], [x0 + 2000, y0], [x0 + 2000, y0 - 2000], [x0, y0 - 2000], [x0, y0]]
    east = [[x0 + 2000, y0], [x0 + 4000, y0], [x0 + 4000, y0 - 2000], [x0 + 2000, y0 - 2000], [x0 + 2000, y0]]
    boundaries = {
        "type": "FeatureCollection",
        "features": [
            {"type": "Feature", "properties": {"name": "Oeste", "code": 1}, "geometry": {"type": "Polygon", "coordinates": [west]}},
            {"type": "Feature", "properties": {"name": "Este", "code": 2}, "geometry": {"type": "Polygon", "coordinates": [east]}},
        ],
    }

    stats = publish.municipality_stats(
        tmp_path / "classes.tif", tmp_path / "score.tif", boundaries, crs=UTM15
    )

    by_name = {f["properties"]["name"]: f["properties"] for f in stats["features"]}
    oeste, este = by_name["Oeste"], by_name["Este"]
    assert oeste["class_share"] == pytest.approx([0.5, 0.5, 0.0, 0.0, 0.0])
    assert este["class_share"] == pytest.approx([0.0, 0.0, 0.0, 0.0, 1.0])
    assert oeste["mean_score"] == pytest.approx(0.2)
    assert este["mean_score"] == pytest.approx(0.9)
    assert este["high_share"] == pytest.approx(1.0)  # classes 4 + 5
    assert este["area_km2"] == pytest.approx(3.0)
    assert este["rank"] == 1 and oeste["rank"] == 2
    json.dumps(stats)  # serialisable

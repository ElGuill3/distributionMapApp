"""Terrain preparation: tile extraction, mosaic and hydrological derivatives."""

import zipfile

import numpy as np
import pytest
import rasterio
from rasterio.transform import from_origin
from rasterio.warp import transform_bounds

from backend.floodmodel import terrain

pytest.importorskip("whitebox", reason="floodmodel dependency group not installed")

UTM15 = "EPSG:32615"


def _write(path, array, x0, y0, res, crs=UTM15, nodata=-9999.0):
    with rasterio.open(
        path,
        "w",
        driver="GTiff",
        width=array.shape[1],
        height=array.shape[0],
        count=1,
        dtype="float32",
        crs=crs,
        transform=from_origin(x0, y0, res, res),
        nodata=nodata,
    ) as dst:
        dst.write(array.astype("float32"), 1)


def test_extract_grid_normalizes_backslash_paths(tmp_path):
    archive = tmp_path / "E15C19E2.zip"
    with zipfile.ZipFile(archive, "w") as zf:
        zf.writestr("MT_Grid\\E15C19E2_MT\\e15c19e2_mt\\hdr.adf", b"h")
        zf.writestr("MT_Grid\\E15C19E2_MT\\e15c19e2_mt\\w001001.adf", b"w")
        zf.writestr("MT_Metadatos\\E15C19E2_MT.html", b"meta")

    grid_dir = terrain.extract_grid(archive, tmp_path / "grids")

    assert grid_dir == tmp_path / "grids" / "E15C19E2" / "e15c19e2_mt"
    assert (grid_dir / "hdr.adf").read_bytes() == b"h"
    assert not list((tmp_path / "grids").rglob("*\\*"))
    assert terrain.extract_grid(archive, tmp_path / "grids") == grid_dir


def test_mosaic_averages_to_target_resolution_and_keeps_gaps_as_nodata(tmp_path):
    left = tmp_path / "left.tif"
    right = tmp_path / "right.tif"
    _write(left, np.arange(16).reshape(4, 4), 0, 20, 5)
    _write(right, np.full((4, 4), 100.0), 40, 20, 5)

    out = terrain.mosaic([left, right], tmp_path / "dem.tif", resolution=10, crs=UTM15)

    with rasterio.open(out) as src:
        dem = src.read(1, masked=True)
        assert src.res == (10.0, 10.0)
        assert src.crs.to_string() == UTM15
        assert dem.shape == (2, 6)
        assert dem[0, 0] == pytest.approx(np.mean([0, 1, 4, 5]))
        assert dem.mask[:, 2:4].all()
        assert dem[1, 5] == pytest.approx(100.0)


def test_derivatives_put_hand_zero_on_channel_and_rise_on_slopes(tmp_path):
    rows, cols = 60, 61
    x = np.abs(np.arange(cols) - cols // 2)[None, :]
    y = np.arange(rows)[:, None]
    dem = 10 + 0.5 * x + 0.05 * (rows - y)
    dem_path = tmp_path / "dem.tif"
    _write(dem_path, dem, 0, rows * 10, 10)

    outputs = terrain.derivatives(dem_path, tmp_path / "out", stream_area_km2=0.05)

    assert set(outputs) == {"hand", "slope", "flow_acc", "twi", "streams"}
    with rasterio.open(outputs["hand"]) as src:
        hand = src.read(1, masked=True)
    channel = hand[10:50, cols // 2]
    ridge = hand[10:50, 2]
    assert float(np.abs(channel).max()) < 0.5
    assert float(ridge.mean()) > 10
    for name in ("slope", "flow_acc", "twi"):
        with rasterio.open(outputs[name]) as src:
            assert src.read(1, masked=True).count() > 0


def test_derivatives_fail_loudly_when_a_tool_produces_no_output(tmp_path, monkeypatch):
    dem_path = tmp_path / "dem.tif"
    _write(dem_path, np.full((10, 10), 5.0), 0, 100, 10)
    import whitebox

    def silent_noop(self, *args, **kwargs):
        return 0  # WhiteboxTools can report success without writing the output

    monkeypatch.setattr(whitebox.WhiteboxTools, "breach_depressions", silent_noop)

    with pytest.raises(RuntimeError, match="breach_depressions.*dem_breached.tif"):
        terrain.derivatives(dem_path, tmp_path / "out")


def test_mosaic_output_is_readable_by_whitebox(tmp_path):
    tile = tmp_path / "tile.tif"
    x = np.abs(np.arange(30) - 15)[None, :]
    _write(tile, 5 + 0.2 * x + 0.01 * np.arange(30)[:, None], 0, 300, 10)
    dem = terrain.mosaic([tile], tmp_path / "dem.tif", resolution=10, crs=UTM15)

    outputs = terrain.derivatives(dem, tmp_path / "out", stream_area_km2=0.01)

    assert outputs["hand"].stat().st_size > 0


@pytest.fixture
def small_strips(monkeypatch):
    # Strips smaller than the test rasters exercise strip boundaries.
    monkeypatch.setattr(terrain, "STRIP_ROWS", 7)


def _write_stack(path, bands, x0, y0, res, names):
    with rasterio.open(
        path,
        "w",
        driver="GTiff",
        width=bands[0].shape[1],
        height=bands[0].shape[0],
        count=len(bands),
        dtype="float32",
        crs=UTM15,
        transform=from_origin(x0, y0, res, res),
        nodata=-9999.0,
    ) as dst:
        for i, band in enumerate(bands, start=1):
            dst.write(band.astype("float32"), i)
        dst.descriptions = tuple(names)


def _valley(rows=60, cols=61):
    x = np.abs(np.arange(cols) - cols // 2)[None, :]
    y = np.arange(rows)[:, None]
    return (10 + 0.5 * x + 0.05 * (rows - y)).astype("float32")


def test_condition_fills_gaps_with_bias_corrected_merit_and_keeps_ocean_empty(
    tmp_path, small_strips
):
    truth = _valley()
    lidar = truth.copy()
    lidar[:, 40:45] = -9999.0  # coverage gap on dry land
    lidar[:, :3] = -9999.0  # ocean: no data anywhere
    merit = truth - 2.0  # MERIT sits 2 m lower (vertical datum offset)
    merit[:, :3] = -9999.0
    occurrence = np.zeros_like(truth)
    upa = np.zeros_like(truth)
    _write(tmp_path / "dem.tif", lidar, 0, 600, 10)
    _write_stack(
        tmp_path / "aux.tif",
        [merit, occurrence, upa],
        0,
        600,
        10,
        ["merit_elv", "gsw_occurrence", "merit_upa_km2"],
    )

    out = terrain.condition(
        tmp_path / "dem.tif", tmp_path / "aux.tif", tmp_path / "cond"
    )

    with rasterio.open(out["dem"]) as src:
        dem = src.read(1, masked=True)
    np.testing.assert_allclose(dem[:, 40:45], truth[:, 40:45], atol=1e-4)
    assert dem.mask[:, :3].all()
    np.testing.assert_allclose(dem[:, 10:20], truth[:, 10:20], atol=1e-4)


def test_hand_is_near_zero_beside_a_river_that_is_a_lidar_hole(tmp_path, small_strips):
    truth = _valley()
    centre = truth.shape[1] // 2
    lidar = truth.copy()
    lidar[:, centre - 1 : centre + 2] = -9999.0  # river surface: no LiDAR return
    merit = truth.copy()
    occurrence = np.zeros_like(truth)
    occurrence[:, centre - 1 : centre + 2] = 100.0
    upa = np.zeros_like(truth)
    _write(tmp_path / "dem.tif", lidar, 0, 600, 10)
    _write_stack(
        tmp_path / "aux.tif",
        [merit, occurrence, upa],
        0,
        600,
        10,
        ["merit_elv", "gsw_occurrence", "merit_upa_km2"],
    )

    cond = terrain.condition(
        tmp_path / "dem.tif", tmp_path / "aux.tif", tmp_path / "cond"
    )
    outputs = terrain.derivatives(
        cond["dem"], tmp_path / "out", stream_area_km2=50, water=cond["water"]
    )

    with rasterio.open(outputs["hand"]) as src:
        hand = src.read(1, masked=True)
    bank = hand[10:50, centre + 2]
    ridge = hand[10:50, 2]
    assert float(bank.mean()) < 1.0
    assert float(np.abs(hand[10:50, centre]).max()) < 1e-3
    assert 10 < float(ridge.mean()) < 20  # true height above the river, no burn offset


def test_hand_never_exceeds_height_above_the_lowest_drainage_with_coastal_lagoon(
    tmp_path, small_strips
):
    # Sea along the north edge stored as a flat 0.0 m surface (as the INEGI
    # LiDAR does), a lagoon that is a LiDAR hole, and land rising southwards.
    rows, cols = 60, 50
    y = np.arange(rows)[:, None]
    x = np.arange(cols)[None, :]
    truth = (0.2 * np.maximum(y - 10, 0) + 0.05 * np.abs(x - 25)).astype("float32")
    lidar = truth.copy()
    lidar[:10, :] = 0.0
    lagoon = (slice(14, 24), slice(15, 35))
    lidar[lagoon] = -9999.0
    merit = truth + 1.0
    merit[lagoon] = 0.5  # MERIT puts the lagoon surface near sea level
    occurrence = np.zeros_like(truth)
    occurrence[:10, :] = 100.0
    occurrence[lagoon] = 95.0
    upa = np.zeros_like(truth)
    _write(tmp_path / "dem.tif", lidar, 0, 600, 10)
    _write_stack(
        tmp_path / "aux.tif",
        [merit, occurrence, upa],
        0,
        600,
        10,
        ["merit_elv", "gsw_occurrence", "merit_upa_km2"],
    )

    cond = terrain.condition(
        tmp_path / "dem.tif", tmp_path / "aux.tif", tmp_path / "cond"
    )
    outputs = terrain.derivatives(
        cond["dem"], tmp_path / "out", stream_area_km2=50, water=cond["water"]
    )

    with rasterio.open(cond["dem"]) as src:
        dem = src.read(1, masked=True)
    with rasterio.open(outputs["hand"]) as src:
        hand = src.read(1, masked=True)
    assert float(hand.min()) >= 0.0
    assert not hand.mask[~dem.mask].any()
    assert (hand <= dem - float(dem.min()) + 1e-3).all()
    assert float(np.abs(hand[lagoon]).max()) < 1e-3


def test_mosaic_extends_to_requested_bounds_with_nodata_outside_tiles(tmp_path):
    _write(tmp_path / "a.tif", np.ones((4, 4), dtype="float32"), 100, 200, 5)

    out = terrain.mosaic(
        [tmp_path / "a.tif"],
        tmp_path / "m.tif",
        resolution=10,
        crs=UTM15,
        bounds=(80, 160, 140, 220),
    )

    with rasterio.open(out) as src:
        assert tuple(src.bounds) == (80, 160, 140, 220)
        dem = src.read(1, masked=True)
    assert dem.shape == (6, 6)
    assert dem.count() == 4  # the 20 m x 20 m tile -> 2 x 2 cells at 10 m
    assert dem.mask[0].all() and dem.mask[:, 0].all()


def test_align_resamples_a_geographic_raster_onto_the_dem_grid(tmp_path):
    _write(
        tmp_path / "dem.tif", np.zeros((10, 10), dtype="float32"), 500000, 2000100, 10
    )
    west, south, east, north = transform_bounds(
        UTM15, "EPSG:4326", 499900, 1999900, 500200, 2000200
    )
    fill = np.full((30, 30), 7.0, dtype="float32")
    _write(
        tmp_path / "fill.tif",
        fill,
        west,
        north,
        (east - west) / 30,
        crs="EPSG:4326",
        nodata=32767,
    )

    out = terrain.align(
        tmp_path / "fill.tif", tmp_path / "dem.tif", tmp_path / "aligned.tif"
    )

    with rasterio.open(out) as src, rasterio.open(tmp_path / "dem.tif") as ref:
        assert (src.crs, src.transform, src.shape) == (
            ref.crs,
            ref.transform,
            ref.shape,
        )
        assert src.nodata == -9999.0
        np.testing.assert_allclose(src.read(1), 7.0)


def test_condition_prefers_bias_corrected_fill_dem_over_merit(tmp_path, small_strips):
    truth = _valley()
    lidar = truth.copy()
    lidar[:, 40:45] = -9999.0  # gap covered by the fill DEM
    lidar[:, 50:53] = -9999.0  # gap the fill DEM also misses -> MERIT
    fill = truth + 3.0  # 3 m datum offset, otherwise exact
    fill[:, 50:53] = -9999.0
    merit = truth - 2.0
    zeros = np.zeros_like(truth)
    _write(tmp_path / "dem.tif", lidar, 0, 600, 10)
    _write(tmp_path / "fill.tif", fill, 0, 600, 10)
    _write_stack(
        tmp_path / "aux.tif",
        [merit, zeros, zeros],
        0,
        600,
        10,
        ["merit_elv", "gsw_occurrence", "merit_upa_km2"],
    )

    out = terrain.condition(
        tmp_path / "dem.tif",
        tmp_path / "aux.tif",
        tmp_path / "cond",
        fill=tmp_path / "fill.tif",
    )

    with rasterio.open(out["dem"]) as src:
        dem = src.read(1)
    np.testing.assert_allclose(dem[:, 40:45], truth[:, 40:45], atol=1e-4)
    np.testing.assert_allclose(dem[:, 50:53], truth[:, 50:53], atol=1e-4)
    assert out["fill_bias_m"] == pytest.approx(-3.0)
    assert out["bias_m"] == pytest.approx(2.0)


def test_grid_bounds_cover_the_state_plus_margin_snapped_to_the_resolution():
    # A square around (-93, 18) in WGS84.
    state = {
        "type": "Polygon",
        "coordinates": [
            [[-93.1, 17.9], [-92.9, 17.9], [-92.9, 18.1], [-93.1, 18.1], [-93.1, 17.9]]
        ],
    }
    from shapely.geometry import box, shape
    from shapely.ops import transform
    from pyproj import Transformer

    project = Transformer.from_crs("EPSG:4326", UTM15, always_xy=True).transform
    utm = transform(project, shape(state))

    left, bottom, right, top = terrain.grid_bounds(
        [state], UTM15, margin_m=2000, resolution=15
    )

    assert box(left, bottom, right, top).contains(utm.buffer(1999))
    assert not box(left, bottom, right, top).contains(utm.buffer(2100))
    for value in (left, bottom, right, top):
        assert value % 15 == 0


def test_earth_engine_steps_share_the_default_terrain_mosaic_grid():
    from pathlib import Path

    from backend.floodmodel import __main__ as cli

    assert cli.TERRAIN_RESOLUTION == 15.0
    assert cli._dem_path(Path("w"), cli.TERRAIN_RESOLUTION).name == "dem_15m.tif"

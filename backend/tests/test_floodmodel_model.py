"""Flood susceptibility model: feature stack, labels, spatial CV, prediction."""

import json
import sys

import numpy as np
import pytest
import rasterio
from rasterio.transform import from_origin

pytest.importorskip("lightgbm", reason="floodmodel dependency group not installed")

import pandas as real_pandas  # noqa: E402  (imported before conftest mocks it)

from backend.floodmodel import model  # noqa: E402

UTM15 = "EPSG:32615"
NODATA = -9999.0


def _write(path, bands, x0, y0, res, names=None, nodata=NODATA, dtype="float32"):
    bands = [np.asarray(b) for b in bands]
    with rasterio.open(
        path,
        "w",
        driver="GTiff",
        width=bands[0].shape[1],
        height=bands[0].shape[0],
        count=len(bands),
        dtype=dtype,
        crs=UTM15,
        transform=from_origin(x0, y0, res, res),
        nodata=nodata,
    ) as dst:
        for i, band in enumerate(bands, start=1):
            dst.write(band.astype(dtype), i)
        if names:
            dst.descriptions = tuple(names)
    return path


def _square(x0, y0, size):
    """GeoJSON polygon in UTM 15N metres (the tests pass crs=UTM15)."""
    return {
        "type": "Polygon",
        "coordinates": [
            [
                [x0, y0],
                [x0 + size, y0],
                [x0 + size, y0 - size],
                [x0, y0 - size],
                [x0, y0],
            ]
        ],
    }


def _geojson(path, geometries):
    features = [
        {"type": "Feature", "properties": {}, "geometry": g} for g in geometries
    ]
    path.write_text(json.dumps({"type": "FeatureCollection", "features": features}))
    return path


@pytest.fixture(autouse=True)
def real_pandas_module(monkeypatch):
    # backend/tests/conftest.py swaps pandas for a MagicMock in sys.modules;
    # scikit-learn and LightGBM look it up there, so give them the real one.
    monkeypatch.setitem(sys.modules, "pandas", real_pandas)


@pytest.fixture
def small_strips(monkeypatch):
    monkeypatch.setattr(model, "STRIP_ROWS", 3)


def test_stack_features_aggregates_terrain_onto_the_grid_and_marks_gaps(
    tmp_path, small_strips
):
    # 15 m terrain, 8x8 cells -> 30 m grid of 4x4 cells.
    hand = np.arange(64, dtype="float32").reshape(8, 8)
    hand[0, 0] = NODATA  # one missing fine cell must not poison the average
    slope = np.full((8, 8), 2.0, dtype="float32")
    _write(tmp_path / "hand.tif", [hand], 0, 120, 15)
    _write(tmp_path / "slope.tif", [slope], 0, 120, 15)
    gee = np.ones((4, 4), dtype="float32")
    gee_inf = gee.copy()
    gee_inf[3, 3] = -np.inf  # Earth Engine masked pixel (open sea)
    _write(
        tmp_path / "gee.tif", [gee, gee_inf], 0, 120, 30, names=["jrc", "worldcover"]
    )

    out = model.stack_features(
        {
            "hand": (tmp_path / "hand.tif", "average"),
            "hand_min": (tmp_path / "hand.tif", "min"),
            "slope": (tmp_path / "slope.tif", "average"),
        },
        tmp_path / "gee.tif",
        tmp_path / "stack.tif",
    )

    with rasterio.open(out) as src:
        assert src.descriptions == ("hand", "hand_min", "slope", "jrc", "worldcover")
        assert (src.width, src.height) == (4, 4)
        stack = src.read()
    # Cell (0, 1) averages fine cells (0,2),(0,3),(1,2),(1,3) = 2,3,10,11.
    assert stack[0, 0, 1] == pytest.approx(6.5)
    assert stack[1, 0, 1] == pytest.approx(2.0)
    assert stack[0, 0, 0] == pytest.approx((1 + 8 + 9) / 3)
    assert np.all(stack[2] == 2.0)
    assert np.isnan(stack[4, 3, 3])
    assert stack[4, 0, 0] == 1.0


def test_label_raster_marks_floods_dry_land_and_exclusions(tmp_path, small_strips):
    occurrence = np.zeros((6, 6), dtype="float32")
    occurrence[5, :] = 90.0  # permanent river along the bottom row
    _write(tmp_path / "stack.tif", [occurrence], 0, 60, 10, names=["gsw_occurrence"])
    event_a = _geojson(tmp_path / "a.geojson", [_square(0, 60, 20)])
    event_b = _geojson(tmp_path / "b.geojson", [_square(40, 60, 10)])
    state = _square(0, 60, 50)  # last column lies outside the state

    out = model.label_raster(
        [event_a, event_b],
        tmp_path / "stack.tif",
        tmp_path / "labels.tif",
        state=state,
        crs=UTM15,
    )

    with rasterio.open(out) as src:
        labels = src.read(1)
        assert src.nodata == 255
    assert (labels[:2, :2] == 1).all()
    assert labels[0, 4] == 1
    assert labels[2, 2] == 0
    assert (labels[5, :] == 255).all()  # permanent water is neither class
    assert (labels[:, 5] == 255).all()  # outside the state


def test_spatial_blocks_group_neighbouring_cells():
    rows = np.array([0, 0, 9, 10, 25])
    cols = np.array([0, 9, 9, 0, 31])

    groups = model.spatial_blocks(rows, cols, block_cells=10, width_cells=40)

    assert groups[0] == groups[1] == groups[2]
    assert groups[3] != groups[0]
    assert len(set(groups.tolist())) == 3


def test_cross_validate_reports_fold_metrics_and_beats_chance_on_a_learnable_rule():
    rng = np.random.default_rng(0)
    n = 4000
    hand = rng.uniform(0, 20, n)
    noise = rng.uniform(0, 1, n)
    y = (hand + 3 * rng.normal(size=n) < 5).astype(int)
    features = np.column_stack([hand, noise])
    groups = rng.integers(0, 20, n)

    report = model.cross_validate(
        features, y, groups, feature_names=["hand", "noise"], n_splits=4, seed=0
    )

    assert len(report["folds"]) == 4
    for fold in report["folds"]:
        assert set(fold) >= {"roc_auc", "pr_auc", "brier", "positives", "n"}
    assert report["mean"]["roc_auc"] > 0.8
    assert report["mean"]["pr_auc"] > report["base_rate"]
    # Folds never share a spatial block.
    for fold in report["folds"]:
        assert not set(fold["test_groups"]) & set(fold["train_groups"])
    assert report["importance"][0][0] == "hand"


def test_predict_writes_probabilities_inside_the_valid_mask_only(
    tmp_path, small_strips
):
    hand = np.tile(np.linspace(0, 20, 7, dtype="float32"), (7, 1))
    noise = np.zeros((7, 7), dtype="float32")
    _write(tmp_path / "stack.tif", [hand, noise], 0, 70, 10, names=["hand", "noise"])
    labels = np.zeros((7, 7), dtype="uint8")
    labels[:, 0] = 255
    _write(tmp_path / "labels.tif", [labels], 0, 70, 10, nodata=255, dtype="uint8")
    rng = np.random.default_rng(1)
    train_hand = rng.uniform(0, 20, 2000)
    fitted = model.fit(
        np.column_stack([train_hand, np.zeros(2000)]),
        (train_hand < 6).astype(int),
        feature_names=["hand", "noise"],
        seed=0,
    )

    out = model.predict(
        fitted, tmp_path / "stack.tif", tmp_path / "labels.tif", tmp_path / "p.tif"
    )

    with rasterio.open(out) as src:
        prob = src.read(1, masked=True)
    assert prob.mask[:, 0].all()
    assert not prob.mask[:, 1:].any()
    assert float(prob.min()) >= 0.0 and float(prob.max()) <= 1.0
    assert prob[3, 1] > 0.5 > prob[3, 6]


def test_sample_training_balances_classes_and_skips_excluded_cells(tmp_path, small_strips):
    rows, cols = 9, 8
    hand = np.arange(rows * cols, dtype="float32").reshape(rows, cols)
    _write(tmp_path / "stack.tif", [hand, hand * 2], 0, 90, 10, names=["hand", "twice"])
    labels = np.zeros((rows, cols), dtype="uint8")
    labels[:2, :] = 1  # 16 positives
    labels[8, :] = 255
    _write(tmp_path / "labels.tif", [labels], 0, 90, 10, nodata=255, dtype="uint8")

    sample = model.sample_training(
        tmp_path / "stack.tif", tmp_path / "labels.tif", per_class=10, block_cells=4, seed=3
    )

    y = sample["labels"]
    assert sample["feature_names"] == ["hand", "twice"]
    assert (y == 1).sum() == 10 and (y == 0).sum() == 10
    assert not (sample["rows"] == 8).any()
    # Features come from the exact sampled cell.
    expected = sample["rows"] * cols + sample["cols"]
    np.testing.assert_array_equal(sample["features"][:, 0], expected)
    np.testing.assert_array_equal(sample["features"][:, 1], expected * 2)
    np.testing.assert_array_equal(y, (sample["rows"] < 2).astype(int))
    np.testing.assert_array_equal(
        sample["groups"], (sample["rows"] // 4) * 2 + sample["cols"] // 4
    )


def test_label_from_masks_floods_any_selected_band_and_keeps_exclusions(tmp_path):
    y2015 = np.array([[1, 0, 0], [0, 0, 0]], dtype="float32")
    y2016 = np.array([[0, 1, 0], [0, 0, 1]], dtype="float32")
    y2024 = np.array([[0, 0, 1], [0, 0, 0]], dtype="float32")
    _write(tmp_path / "s1.tif", [y2015, y2016, y2024], 0, 20, 10, names=["s1_2015", "s1_2016", "s1_2024"])
    base = np.array([[0, 0, 0], [0, 255, 255]], dtype="uint8")
    _write(tmp_path / "base.tif", [base], 0, 20, 10, nodata=255, dtype="uint8")

    out = model.label_from_masks(
        tmp_path / "s1.tif", ["s1_2015", "s1_2016"], tmp_path / "base.tif", tmp_path / "l.tif"
    )

    with rasterio.open(out) as src:
        labels = src.read(1)
    np.testing.assert_array_equal(labels, [[1, 1, 0], [0, 255, 255]])


def test_ensemble_averages_state_relative_ranks_of_each_component(tmp_path, small_strips):
    a = np.array([[1, 2, 3, 4]] * 4, dtype="float32")
    b = np.array([[40, 30, 20, 10]] * 4, dtype="float32")
    c = a.copy()
    c[0, 0] = NODATA  # a missing component is skipped, not treated as low
    _write(tmp_path / "a.tif", [a], 0, 40, 10)
    _write(tmp_path / "b.tif", [b * 1000], 0, 40, 10)  # scale must not matter
    _write(tmp_path / "c.tif", [c], 0, 40, 10)
    labels = np.zeros((4, 4), dtype="uint8")
    labels[3, :] = 255
    _write(tmp_path / "labels.tif", [labels], 0, 40, 10, nodata=255, dtype="uint8")

    out = model.ensemble(
        {"a": tmp_path / "a.tif", "b": tmp_path / "b.tif", "c": tmp_path / "c.tif"},
        tmp_path / "labels.tif",
        tmp_path / "ens.tif",
        sample_size=1000,
    )

    with rasterio.open(out) as src:
        ens = src.read(1, masked=True)
    assert ens.mask[3].all()
    assert float(ens.min()) >= 0.0 and float(ens.max()) <= 1.0
    # Empirical CDF over the 12 valid cells (11 for c): a -> .25,.5,.75,1;
    # b reversed; c -> 2/11, 5/11, 8/11, 1.
    assert ens[1, 0] == pytest.approx((0.25 + 1.0 + 2 / 11) / 3)
    assert ens[1, 3] == pytest.approx((1.0 + 0.25 + 1.0) / 3)
    # A missing component is skipped, not treated as a low score.
    assert ens[0, 0] == pytest.approx((0.25 + 1.0) / 2)


def test_score_events_reports_roc_and_pr_per_event_and_source():
    rng = np.random.default_rng(0)
    truth = rng.uniform(size=5000)
    event = (truth > 0.8).astype(int)
    scores = {"good": truth + rng.normal(scale=0.1, size=5000), "random": rng.uniform(size=5000)}

    table = model.score_events(scores, {"2011": event})

    assert set(table) == {"good", "random"}
    assert table["good"]["2011"]["roc_auc"] > 0.9
    assert 0.4 < table["random"]["2011"]["roc_auc"] < 0.6
    assert table["good"]["2011"]["base_rate"] == pytest.approx(event.mean())


def test_label_from_masks_rejects_rasters_on_different_grids(tmp_path):
    _write(tmp_path / "s1.tif", [np.zeros((3, 4))], 0, 30, 10, names=["s1_2015"])
    _write(tmp_path / "base.tif", [np.zeros((3, 3))], 0, 30, 10, nodata=255, dtype="uint8")

    with pytest.raises(ValueError, match="grid"):
        model.label_from_masks(tmp_path / "s1.tif", ["s1_2015"], tmp_path / "base.tif", tmp_path / "l.tif")
    assert not (tmp_path / "l.tif").exists()


def test_score_events_ignores_nodata_scores_and_unlabelled_truth():
    score = np.array([0.9, 0.8, 0.1, 0.2, NODATA, 0.5])
    truth = np.array([1, 1, 0, 0, 1, np.nan])

    table = model.score_events({"s": score}, {"e": truth})

    assert table["s"]["e"]["n"] == 4
    assert table["s"]["e"]["roc_auc"] == pytest.approx(1.0)
    assert table["s"]["e"]["base_rate"] == pytest.approx(0.5)


def test_train_report_records_hyperparameters_and_seed(tmp_path, monkeypatch):
    from backend.floodmodel import pipeline

    work = tmp_path / "work"
    feat = work / "features"
    feat.mkdir(parents=True)
    rng = np.random.default_rng(0)
    hand = rng.uniform(0, 20, (40, 40)).astype("float32")
    _write(feat / "stack_30m.tif", [hand, hand * 0], 0, 1200, 30, names=["hand", "noise"])
    labels = (hand < 6).astype("uint8")
    _write(feat / "labels_30m.tif", [labels], 0, 1200, 30, nodata=255, dtype="uint8")

    pipeline.train(work, "m", feat / "labels_30m.tif", per_class=200, cv=False, drop=())

    report = json.loads((work / "model" / "m" / "report.json").read_text())
    assert report["seed"] == 0
    assert report["params"]["n_estimators"] == model.DEFAULT_PARAMS["n_estimators"]
    assert report["features"] == ["hand", "noise"]


def test_score_events_reports_how_much_flooding_falls_in_the_top_40_percent():
    # 10 cells; the top 40 % by score are cells 6-9.
    score = np.arange(10, dtype="float64")
    truth = np.array([0, 0, 0, 0, 0, 1, 1, 1, 0, 1])  # 3 of 4 flooded in top 40 %

    row = model.score_events({"s": score}, {"e": truth})["s"]["e"]

    assert row["top40_area_share"] == pytest.approx(0.4)
    assert row["top40_capture"] == pytest.approx(0.75)


def test_capture_counts_ties_at_the_cut_and_reports_the_real_area():
    # A few-class map: the 60th percentile is 4, shared by four cells, so the
    # top set holds every 4 and the 5, half of the area rather than 40 %.
    score = np.array([1, 1, 2, 2, 3, 4, 4, 4, 4, 5], dtype="float64")
    truth = np.array([0, 0, 0, 0, 1, 0, 0, 0, 0, 1])  # 1 of 2 flooded in the top set

    row = model.score_events({"s": score}, {"e": truth})["s"]["e"]

    assert row["top40_area_share"] == pytest.approx(0.5)
    assert row["top40_capture"] == pytest.approx(0.5)

"""Flood susceptibility model trained on observed floods.

Every cell of the prediction grid gets terrain (LiDAR) and Earth Engine
features. Cells inside any CENAPRED flood polygon are positives, the rest of
the state is negative, and permanent water is excluded. A gradient boosting
classifier is validated with spatially blocked cross-validation so nearby,
correlated cells never sit on both sides of a split. Raster passes stream over
row strips so memory stays bounded on the statewide grid.
"""

from __future__ import annotations

import json
import math
from pathlib import Path

import numpy as np
import rasterio
import rasterio.windows
from rasterio.enums import Resampling
from rasterio.features import rasterize
from rasterio.vrt import WarpedVRT

NODATA = -9999.0
LABEL_NODATA = 255
STRIP_ROWS = 256

DEFAULT_PARAMS = {
    "n_estimators": 400,
    "learning_rate": 0.05,
    "num_leaves": 63,
    "min_child_samples": 50,
    "subsample": 0.8,
    "subsample_freq": 1,
    "colsample_bytree": 0.8,
    "reg_lambda": 1.0,
    "n_jobs": 4,
    "verbose": -1,
}


def _strips(height: int):
    for row in range(0, height, STRIP_ROWS):
        yield row, min(STRIP_ROWS, height - row)


def _as_nan(block: np.ndarray, nodata) -> np.ndarray:
    block = block.astype("float32")
    bad = ~np.isfinite(block)
    if nodata is not None and not (isinstance(nodata, float) and math.isnan(nodata)):
        bad |= block == nodata
    block[bad] = np.nan
    return block


def stack_features(terrain: dict, gee: Path, output: Path) -> Path:
    """Write one float32 band per feature on the ``gee`` grid (NaN = missing).

    ``terrain`` maps a feature name to ``(path, resampling)``; each source is
    aggregated onto the coarser grid with that resampling (nodata ignored).
    Earth Engine bands follow, keeping their descriptions.
    """
    with rasterio.open(gee) as grid:
        profile = grid.profile.copy()
        gee_names = list(grid.descriptions)
        width, height = grid.width, grid.height
        names = list(terrain) + gee_names
        profile.update(
            driver="GTiff",
            count=len(names),
            dtype="float32",
            nodata=float("nan"),
            compress="deflate",
            BIGTIFF="IF_SAFER",
        )
        for key in ("tiled", "blockxsize", "blockysize", "predictor"):
            profile.pop(key, None)
        sources = [rasterio.open(path) for path, _ in terrain.values()]
        vrts = [
            WarpedVRT(
                src,
                crs=grid.crs,
                transform=grid.transform,
                width=width,
                height=height,
                resampling=Resampling[method],
                src_nodata=src.nodata,
                nodata=NODATA,
            )
            for src, (_, method) in zip(sources, terrain.values(), strict=True)
        ]
        output.parent.mkdir(parents=True, exist_ok=True)
        try:
            with rasterio.open(output, "w", **profile) as dst:
                dst.descriptions = tuple(names)
                for row, rows in _strips(height):
                    window = rasterio.windows.Window(0, row, width, rows)
                    band = 1
                    for vrt in vrts:
                        dst.write(
                            _as_nan(vrt.read(1, window=window), NODATA),
                            band,
                            window=window,
                        )
                        band += 1
                    for i in range(1, grid.count + 1):
                        block = _as_nan(grid.read(i, window=window), grid.nodata)
                        dst.write(block, band, window=window)
                        band += 1
        finally:
            for handle in vrts + sources:
                handle.close()
    return output


def _project(geometries: list, crs_from: str, crs_to) -> list:
    from pyproj import Transformer
    from shapely.geometry import mapping, shape
    from shapely.ops import transform

    if rasterio.crs.CRS.from_user_input(crs_from) == rasterio.crs.CRS.from_user_input(
        crs_to
    ):
        return geometries
    project = Transformer.from_crs(crs_from, crs_to, always_xy=True).transform
    return [mapping(transform(project, shape(g))) for g in geometries]


def label_raster(
    events: list[Path],
    stack: Path,
    output: Path,
    *,
    state: dict,
    crs: str = "EPSG:4326",
    occurrence_band: str = "gsw_occurrence",
    water_threshold: float = 50.0,
) -> Path:
    """1 = flooded in any event, 0 = dry, 255 = permanent water / outside state."""
    with rasterio.open(stack) as src:
        shape_ = (src.height, src.width)
        transform_ = src.transform
        profile = src.profile.copy()
        occurrence_index = list(src.descriptions).index(occurrence_band) + 1
        # One event file at a time keeps only one polygon set in memory.
        flooded = np.zeros(shape_, dtype="uint8")
        for path in events:
            data = json.loads(Path(path).read_text())
            geometries = [f["geometry"] for f in data["features"] if f.get("geometry")]
            del data
            if geometries:
                flooded |= rasterize(
                    ((g, 1) for g in _project(geometries, crs, src.crs)),
                    out_shape=shape_,
                    transform=transform_,
                    fill=0,
                    dtype="uint8",
                )
            del geometries
        inside = rasterize(
            [(_project([state], crs, src.crs)[0], 1)],
            out_shape=shape_,
            transform=transform_,
            fill=0,
            dtype="uint8",
        ).astype(bool)
        labels = np.full(shape_, LABEL_NODATA, dtype="uint8")
        for row, rows in _strips(src.height):
            window = rasterio.windows.Window(0, row, src.width, rows)
            occurrence = _as_nan(src.read(occurrence_index, window=window), src.nodata)
            water = ~np.isfinite(occurrence) | (occurrence >= water_threshold)
            keep = inside[row : row + rows] & ~water
            labels[row : row + rows][keep] = flooded[row : row + rows][keep]
    profile.update(
        driver="GTiff", count=1, dtype="uint8", nodata=LABEL_NODATA, compress="deflate"
    )
    for key in ("tiled", "blockxsize", "blockysize", "predictor"):
        profile.pop(key, None)
    output.parent.mkdir(parents=True, exist_ok=True)
    with rasterio.open(output, "w", **profile) as dst:
        dst.write(labels, 1)
    return output


def spatial_blocks(
    rows: np.ndarray, cols: np.ndarray, *, block_cells: int, width_cells: int
) -> np.ndarray:
    """Block id of each cell for spatially grouped cross-validation."""
    per_row = math.ceil(width_cells / block_cells)
    return (np.asarray(rows) // block_cells) * per_row + np.asarray(cols) // block_cells


def sample_training(
    stack: Path,
    labels: Path,
    *,
    per_class: int,
    block_cells: int,
    seed: int = 0,
) -> dict:
    """Balanced random sample of labelled cells with features and block ids."""
    rng = np.random.default_rng(seed)
    with rasterio.open(labels) as src:
        label = src.read(1)
    picked = []
    for value in (0, 1):
        index = np.flatnonzero(label == value)
        if index.size > per_class:
            index = rng.choice(index, per_class, replace=False)
        picked.append(index)
    index = np.sort(np.concatenate(picked))
    del label
    with rasterio.open(stack) as src:
        names = list(src.descriptions)
        width, height = src.width, src.height
        rows, cols = np.divmod(index, width)
        features = np.empty((index.size, len(names)), dtype="float32")
        for row, count in _strips(height):
            sel = (rows >= row) & (rows < row + count)
            if not sel.any():
                continue
            block = src.read(window=rasterio.windows.Window(0, row, width, count))
            features[sel] = block[:, rows[sel] - row, cols[sel]].T
    with rasterio.open(labels) as src:
        y = np.empty(index.size, dtype="uint8")
        for row, count in _strips(height):
            sel = (rows >= row) & (rows < row + count)
            if sel.any():
                block = src.read(
                    1, window=rasterio.windows.Window(0, row, width, count)
                )
                y[sel] = block[rows[sel] - row, cols[sel]]
    return {
        "features": features,
        "labels": y.astype(int),
        "groups": spatial_blocks(
            rows, cols, block_cells=block_cells, width_cells=width
        ),
        "rows": rows,
        "cols": cols,
        "feature_names": names,
    }


def _frame(features: np.ndarray, names: list[str]):
    import pandas as pd

    return pd.DataFrame(features, columns=names)


def fit(features, labels, *, feature_names: list[str], seed: int = 0, params=None):
    from lightgbm import LGBMClassifier

    classifier = LGBMClassifier(
        random_state=seed, **{**DEFAULT_PARAMS, **(params or {})}
    )
    classifier.fit(_frame(features, feature_names), labels)
    return classifier


def cross_validate(
    features,
    labels,
    groups,
    *,
    feature_names: list[str],
    n_splits: int = 5,
    seed: int = 0,
    params=None,
) -> dict:
    """Spatially grouped CV: ROC AUC, PR AUC and Brier per fold and averaged."""
    from sklearn.metrics import average_precision_score, brier_score_loss, roc_auc_score
    from sklearn.model_selection import StratifiedGroupKFold

    labels = np.asarray(labels)
    groups = np.asarray(groups)
    splitter = StratifiedGroupKFold(n_splits=n_splits, shuffle=True, random_state=seed)
    folds = []
    for train, test in splitter.split(features, labels, groups):
        classifier = fit(
            features[train],
            labels[train],
            feature_names=feature_names,
            seed=seed,
            params=params,
        )
        prob = classifier.predict_proba(_frame(features[test], feature_names))[:, 1]
        folds.append(
            {
                "roc_auc": float(roc_auc_score(labels[test], prob)),
                "pr_auc": float(average_precision_score(labels[test], prob)),
                "brier": float(brier_score_loss(labels[test], prob)),
                "positives": int(labels[test].sum()),
                "n": int(test.size),
                "train_groups": np.unique(groups[train]).tolist(),
                "test_groups": np.unique(groups[test]).tolist(),
            }
        )
    final = fit(features, labels, feature_names=feature_names, seed=seed, params=params)
    gain = final.booster_.feature_importance(importance_type="gain")
    importance = sorted(
        zip(feature_names, (float(g) for g in gain), strict=True), key=lambda kv: -kv[1]
    )
    metrics = ("roc_auc", "pr_auc", "brier")
    return {
        "folds": folds,
        "mean": {m: float(np.mean([f[m] for f in folds])) for m in metrics},
        "std": {m: float(np.std([f[m] for f in folds])) for m in metrics},
        "base_rate": float(labels.mean()),
        "importance": importance,
    }


def predict(classifier, stack: Path, labels: Path, output: Path) -> Path:
    """Flood susceptibility (0-1) for every labelled cell, strip by strip."""
    names = list(classifier.feature_name_)
    with rasterio.open(stack) as src, rasterio.open(labels) as lab:
        index = [list(src.descriptions).index(n) + 1 for n in names]
        profile = src.profile.copy()
        profile.update(
            driver="GTiff", count=1, dtype="float32", nodata=NODATA, compress="deflate"
        )
        for key in ("tiled", "blockxsize", "blockysize", "predictor"):
            profile.pop(key, None)
        output.parent.mkdir(parents=True, exist_ok=True)
        with rasterio.open(output, "w", **profile) as dst:
            for row, rows in _strips(src.height):
                window = rasterio.windows.Window(0, row, src.width, rows)
                valid = lab.read(1, window=window) != LABEL_NODATA
                out = np.full((rows, src.width), NODATA, dtype="float32")
                if valid.any():
                    block = src.read(index, window=window)
                    cells = block[:, valid].T
                    out[valid] = classifier.predict_proba(_frame(cells, names))[:, 1]
                dst.write(out, 1, window=window)
    return output

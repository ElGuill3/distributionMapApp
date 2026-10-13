"""Training, ensembling and validation steps on the prepared 30 m grid.

The final susceptibility map is the equal-weight rank average of three
components: a model trained on CENAPRED's extreme flood events, a model
trained on Sentinel-1 seasonal flooding, and JRC's 100-year flood depth.
``validate`` rebuilds the same map from held-out versions of both models and
scores it on events neither model saw.
"""

from __future__ import annotations

import json
from pathlib import Path

import numpy as np
import rasterio

from backend.floodmodel import cenapred, model

DROP_FEATURES = ("gsw_occurrence", "gsw_max_extent")  # may contain the labels
FIRST_S1_YEAR, LAST_S1_YEAR = 2015, 2025
VALIDATION_S1_YEARS = (2023, 2024, 2025)  # after IPCET-PNUD 2022 was published
VALIDATION_EVENT = "flood_2011_10_22"


def paths(work_dir: Path) -> dict:
    feat, out = work_dir / "features", work_dir / "model"
    return {
        "stack": feat / "stack_30m.tif",
        "labels": feat / "labels_30m.tif",
        "s1": feat / "s1_seasons_30m.tif",
        "boundaries": work_dir / "boundaries" / "municipalities.geojson",
        "inventory": work_dir / "inventory",
        "model": out,
    }


def state_geometry(work_dir: Path) -> dict:
    from shapely.geometry import mapping, shape
    from shapely.ops import unary_union

    data = json.loads(paths(work_dir)["boundaries"].read_text())
    return mapping(unary_union([shape(f["geometry"]) for f in data["features"]]))


def cenapred_labels(work_dir: Path, events: list[str], output: Path) -> Path:
    p = paths(work_dir)
    return model.label_raster(
        [p["inventory"] / f"{name}.geojson" for name in events],
        p["stack"],
        output,
        state=state_geometry(work_dir),
    )


def s1_labels(work_dir: Path, years: list[int], output: Path) -> Path:
    p = paths(work_dir)
    return model.label_from_masks(
        p["s1"], [f"s1_{y}" for y in years], p["labels"], output
    )


def train(
    work_dir: Path,
    name: str,
    labels: Path,
    *,
    per_class: int = 150_000,
    block_km: float = 5.0,
    folds: int = 5,
    drop: tuple = DROP_FEATURES,
    cv: bool = True,
) -> Path:
    """Fit LightGBM on ``labels``, write CV report and statewide prediction."""
    import joblib

    p = paths(work_dir)
    out_dir = p["model"] / name
    out_dir.mkdir(parents=True, exist_ok=True)
    sample = model.sample_training(
        p["stack"],
        labels,
        per_class=per_class,
        block_cells=max(1, round(block_km * 1000 / 30)),
    )
    keep = [i for i, n in enumerate(sample["feature_names"]) if n not in drop]
    names = [sample["feature_names"][i] for i in keep]
    features = sample["features"][:, keep]
    report = {
        "labels": str(labels),
        "per_class": per_class,
        "dropped": list(drop),
        "features": names,
        "seed": 0,
        "params": model.training_params(seed=0),
    }
    if cv:
        cv_report = model.cross_validate(
            features,
            sample["labels"],
            sample["groups"],
            feature_names=names,
            n_splits=folds,
        )
        for fold in cv_report["folds"]:
            fold["train_groups"] = len(fold["train_groups"])
            fold["test_groups"] = len(fold["test_groups"])
        report |= cv_report | {"block_km": block_km}
    fitted = model.fit(features, sample["labels"], feature_names=names)
    joblib.dump(fitted, out_dir / "model.joblib")
    (out_dir / "report.json").write_text(json.dumps(report, indent=2))
    return model.predict(
        fitted, p["stack"], p["labels"], out_dir / "susceptibility_30m.tif"
    )


def stack_band(work_dir: Path, band: str, output: Path) -> Path:
    """Copy one feature band (e.g. JRC depth) to its own raster."""
    with rasterio.open(paths(work_dir)["stack"]) as src:
        data = src.read(list(src.descriptions).index(band) + 1)
        profile = src.profile.copy()
    data = np.where(np.isfinite(data), data, model.NODATA)
    return model._write_single(
        output, profile, data, dtype="float32", nodata=model.NODATA
    )


def build_ensemble(work_dir: Path, extreme: Path, seasonal: Path, output: Path) -> Path:
    p = paths(work_dir)
    jrc = stack_band(work_dir, "jrc_depth_rp100", p["model"] / "jrc_rp100.tif")
    return model.ensemble(
        {"extreme": extreme, "seasonal": seasonal, "jrc": jrc}, p["labels"], output
    )


def final(work_dir: Path) -> Path:
    """Models on every event, then the published susceptibility map."""
    p = paths(work_dir)
    extreme = train(work_dir, "extreme", p["labels"])
    years = list(range(FIRST_S1_YEAR, LAST_S1_YEAR + 1))
    seasonal_labels = s1_labels(work_dir, years, p["model"] / "labels_seasonal.tif")
    seasonal = train(work_dir, "seasonal", seasonal_labels)
    return build_ensemble(
        work_dir, extreme, seasonal, p["model"] / "susceptibility_30m.tif"
    )


def _sample_scores(maps: dict, label: np.ndarray, size: int, seed: int) -> tuple:
    ok = label != model.LABEL_NODATA
    for values in maps.values():
        ok &= np.isfinite(values) & (values != model.NODATA)
    index = np.flatnonzero(ok)
    index = np.random.default_rng(seed).choice(
        index, min(size, index.size), replace=False
    )
    return index, {k: v.ravel()[index] for k, v in maps.items()}


def _read(path: Path) -> np.ndarray:
    with rasterio.open(path) as src:
        return model._as_nan(src.read(1), src.nodata)


def validate(work_dir: Path, *, sample_size: int = 1_000_000, seed: int = 0) -> dict:
    """Score held-out models and baselines on events none of them saw.

    * extreme model trained on CENAPRED 2020 only, tested on the 2011 flood;
    * seasonal model trained on Sentinel-1 2015-2022, tested on 2023-2025;
    * the ensemble of both held-out models plus JRC, against JRC, elevation and
      the official IPCET-PNUD 2022 map (which likely used 2011 and 2020).

    Scope of the numbers: they come from a random sample of ``sample_size``
    cells restricted to cells where every compared map has a value (which
    limits them to the IPCET-PNUD 2022 footprint), and the held-out models are
    refits, not the published models trained on every event.
    """
    p = paths(work_dir)
    out = p["model"] / "validation"
    out.mkdir(parents=True, exist_ok=True)
    later = [e for e in cenapred.FLOOD_EVENTS if e != VALIDATION_EVENT]
    extreme = train(
        work_dir,
        "validation/extreme",
        cenapred_labels(work_dir, later, out / "labels_extreme.tif"),
        cv=False,
    )
    train_years = [
        y
        for y in range(FIRST_S1_YEAR, LAST_S1_YEAR + 1)
        if y < min(VALIDATION_S1_YEARS)
    ]
    seasonal = train(
        work_dir,
        "validation/seasonal",
        s1_labels(work_dir, train_years, out / "labels_seasonal.tif"),
        cv=False,
    )
    ens = build_ensemble(work_dir, extreme, seasonal, out / "ensemble_30m.tif")
    held_out = cenapred_labels(work_dir, [VALIDATION_EVENT], out / "labels_2011.tif")

    with rasterio.open(p["labels"]) as src:
        transform, shape_, crs = src.transform, (src.height, src.width), src.crs
        valid = src.read(1)
    with rasterio.open(p["stack"]) as src:
        names = list(src.descriptions)
        jrc = model._as_nan(src.read(names.index("jrc_depth_rp100") + 1), None)
        elevation = model._as_nan(src.read(names.index("elevation") + 1), None)
    maps = {
        "ensemble": _read(ens),
        "extreme_model": _read(extreme),
        "seasonal_model": _read(seasonal),
        "jrc_rp100": jrc,
        "low_elevation": -elevation,
        "ipcet_pnud_2022": _ipcet(work_dir, transform, shape_, crs),
    }
    index, scores = _sample_scores(maps, valid, sample_size, seed)
    events = {"cenapred_2011": _read(held_out).ravel()[index] == 1}
    with rasterio.open(p["s1"]) as src:
        bands = list(src.descriptions)
        for year in VALIDATION_S1_YEARS:
            events[f"s1_{year}"] = (
                src.read(bands.index(f"s1_{year}") + 1).ravel()[index] == 1
            )
    table = model.score_events(scores, events)
    result = {
        "protocol": {
            "extreme_training_events": later,
            "seasonal_training_years": train_years,
            "held_out_event": VALIDATION_EVENT,
            "held_out_s1_years": list(VALIDATION_S1_YEARS),
            "sample_cells": int(index.size),
            "ipcet_note": "IPCET-PNUD 2022 likely used the 2011 and 2020 floods",
        },
        "scores": table,
    }
    (p["model"] / "validation.json").write_text(json.dumps(result, indent=2))
    return result


def _ipcet(work_dir: Path, transform, shape_, crs) -> np.ndarray:
    """IPCET-PNUD 2022 susceptibility class (1-5) on the grid; NaN elsewhere."""
    from rasterio.features import rasterize

    data = json.loads(
        (
            paths(work_dir)["inventory"] / "susceptibility_ipcet_pnud_2022.geojson"
        ).read_text()
    )
    geometries = [f["geometry"] for f in data["features"] if f.get("geometry")]
    codes = [
        int(f["properties"]["gridcode"]) for f in data["features"] if f.get("geometry")
    ]
    del data
    projected = model._project(geometries, "EPSG:4326", crs)
    grid = rasterize(
        zip(projected, codes, strict=True),
        out_shape=shape_,
        transform=transform,
        fill=0,
        dtype="int16",
    ).astype("float32")
    grid[grid <= 0] = np.nan  # outside the map or water bodies (class 0)
    return grid

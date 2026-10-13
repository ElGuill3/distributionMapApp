"""Terrain preparation: INEGI tile extraction, mosaic and hydrological derivatives.

Derivatives are computed with WhiteboxTools:
  * depressions are breached (Lindsay 2016), keeping flat floodplains realistic;
  * D8 flow directions and accumulation define the drainage network;
  * HAND (height above nearest drainage) is the elevation above the stream cell
    each location drains to — the main terrain predictor of flood susceptibility;
  * slope and the topographic wetness index complete the terrain features.
"""

from __future__ import annotations

import zipfile
from pathlib import Path

import numpy as np
import rasterio
import rasterio.windows
from rasterio.enums import Resampling
from rasterio.merge import merge

NODATA = -9999.0
# INEGI LiDAR: UTM zone 15, ITRF92 (within 1 m of WGS 84), NAVD88 heights.
LIDAR_CRS = "EPSG:32615"
_GRID_ROOT = "MT_Grid/"


def extract_grid(archive: Path, out_dir: Path) -> Path:
    """Extract the ArcInfo grid of one INEGI tile and return its directory.

    INEGI archives store Windows paths (``MT_Grid\\SHEET_MT\\sheet_mt\\hdr.adf``);
    they are normalized so the grid lands in ``out_dir/SHEET/sheet_mt``.
    """
    sheet = archive.stem
    target = out_dir / sheet
    existing = next(target.rglob("hdr.adf"), None) if target.exists() else None
    if existing is not None:
        return existing.parent

    with zipfile.ZipFile(archive) as zf:
        for info in zf.infolist():
            name = info.filename.replace("\\", "/")
            if info.is_dir() or not name.startswith(_GRID_ROOT):
                continue
            parts = name[len(_GRID_ROOT) :].split("/")[1:]  # drop SHEET_MT
            if not parts or any(p in ("", "..") for p in parts):
                continue
            destination = target.joinpath(*parts)
            destination.parent.mkdir(parents=True, exist_ok=True)
            destination.write_bytes(zf.read(info))

    header = next(target.rglob("hdr.adf"), None)
    if header is None:
        raise ValueError(f"No ArcInfo grid found in {archive.name}")
    return header.parent


# Rows per strip for numpy steps: a statewide 15 m band is 229 Mpx (0.9 GB as
# float32), so whole-array passes over several bands exhaust memory.
STRIP_ROWS = 512


def _strips(height: int):
    for row in range(0, height, STRIP_ROWS):
        yield rasterio.windows.Window(0, row, None, min(STRIP_ROWS, height - row))


def _out_profile(profile: dict, **overrides) -> dict:
    out = {**profile, "driver": "GTiff", "count": 1, "compress": "deflate"}
    out.update(BIGTIFF="IF_SAFER", **overrides)
    for key in ("tiled", "blockxsize", "blockysize", "predictor"):
        out.pop(key, None)
    return out


def _map_strips(inputs: dict, outputs: dict, func) -> None:
    """Apply ``func`` strip by strip.

    ``inputs`` maps a name to ``(path, band)``; ``func`` receives a dict of
    float32 strips (plus ``<name>_nodata``) and returns a dict of output
    strips keyed like ``outputs``, which maps a name to ``(path, overrides)``
    applied on top of the first input's profile.
    """
    sources = {name: rasterio.open(path) for name, (path, _) in inputs.items()}
    try:
        first = next(iter(sources.values()))
        width, height = first.width, first.height
        sinks = {}
        for name, (path, overrides) in outputs.items():
            Path(path).parent.mkdir(parents=True, exist_ok=True)
            sinks[name] = rasterio.open(
                path, "w", **_out_profile(first.profile, **overrides)
            )
        try:
            for strip in _strips(height):
                window = rasterio.windows.Window(0, strip.row_off, width, strip.height)
                data = {}
                for name, (_, band) in inputs.items():
                    data[name] = (
                        sources[name].read(band, window=window).astype("float32")
                    )
                    data[f"{name}_nodata"] = sources[name].nodata
                for name, block in func(data).items():
                    sink = sinks[name]
                    sink.write(block.astype(sink.dtypes[0]), 1, window=window)
        finally:
            for sink in sinks.values():
                sink.close()
    finally:
        for src in sources.values():
            src.close()


def condition(
    dem: Path,
    aux: Path,
    out_dir: Path,
    *,
    occurrence_threshold: float = 50.0,
    river_upa_km2: float = 500.0,
) -> dict:
    """Hydrologically condition the LiDAR DEM before deriving drainage.

    The INEGI terrain model has no returns over rivers and lagoons and a few
    coverage gaps. Gaps are filled with MERIT elevation shifted by the median
    LiDAR-MERIT offset (vertical datum difference). Water is JRC surface water
    (occurrence >= threshold) plus MERIT rivers (upstream area >= river_upa_km2);
    it is returned as a mask so ``derivatives`` can force drainage through it.
    Both passes stream over row strips so memory stays bounded.
    """
    with rasterio.open(aux) as src:
        band = {name: i + 1 for i, name in enumerate(src.descriptions)}
    inputs = {
        "lidar": (dem, 1),
        "merit": (aux, band["merit_elv"]),
        "occurrence": (aux, band["gsw_occurrence"]),
        "upa": (aux, band["merit_upa_km2"]),
    }

    def masks(d):
        lidar_ok = np.isfinite(d["lidar"]) & (d["lidar"] != d["lidar_nodata"])
        merit_ok = np.isfinite(d["merit"]) & (d["merit"] != d["merit_nodata"])
        occurrence = np.where(
            d["occurrence"] == d["occurrence_nodata"], 0, d["occurrence"]
        )
        upa = np.where(d["upa"] == d["upa_nodata"], 0, d["upa"])
        water = (occurrence >= occurrence_threshold) | (upa >= river_upa_km2)
        return lidar_ok, merit_ok, water

    samples = []

    def collect(d):
        lidar_ok, merit_ok, water = masks(d)
        overlap = lidar_ok & merit_ok & ~water
        samples.append((d["lidar"] - d["merit"])[overlap][::7])
        return {}

    _map_strips(inputs, {}, collect)
    offsets = np.concatenate(samples) if samples else np.empty(0, "float32")
    bias = float(np.median(offsets)) if offsets.size else 0.0
    samples.clear()
    del offsets

    def fill(d):
        lidar_ok, merit_ok, water = masks(d)
        filled = np.where(
            lidar_ok, d["lidar"], np.where(merit_ok, d["merit"] + bias, NODATA)
        )
        return {"dem": filled, "water": np.where(filled != NODATA, water, 255)}

    out_dir.mkdir(parents=True, exist_ok=True)
    dem_out = out_dir / "dem_conditioned.tif"
    water_out = out_dir / "water.tif"
    _map_strips(
        inputs,
        {
            "dem": (dem_out, {"dtype": "float32", "nodata": NODATA}),
            "water": (water_out, {"dtype": "uint8", "nodata": 255}),
        },
        fill,
    )
    return {"dem": dem_out, "water": water_out, "bias_m": bias}


def mosaic(sources: list[Path], output: Path, *, resolution: float, crs: str) -> Path:
    """Merge tiles into one GeoTIFF, averaging cells down to ``resolution``."""
    datasets = [rasterio.open(path) for path in sources]
    try:
        array, transform = merge(
            datasets,
            res=resolution,
            resampling=Resampling.average,
            nodata=NODATA,
            dtype="float32",
        )
    finally:
        for dataset in datasets:
            dataset.close()

    output.parent.mkdir(parents=True, exist_ok=True)
    profile = {
        "driver": "GTiff",
        "width": array.shape[2],
        "height": array.shape[1],
        "count": 1,
        "dtype": "float32",
        "crs": crs,
        "transform": transform,
        "nodata": NODATA,
        # WhiteboxTools silently fails on tiled / predictor-3 GeoTIFFs: keep
        # striped deflate, which it reads.
        "compress": "deflate",
        "BIGTIFF": "IF_SAFER",
    }
    with rasterio.open(output, "w", **profile) as dst:
        dst.write(array[0], 1)
    return output


def derivatives(
    dem: Path,
    out_dir: Path,
    *,
    stream_area_km2: float = 1.0,
    water: Path | None = None,
) -> dict:
    """Compute HAND, slope, flow accumulation, TWI and streams from ``dem``.

    ``stream_area_km2`` is the contributing area that starts a channel. With a
    ``water`` mask (from ``condition``) rivers, lagoons and sea join the drainage
    network and HAND is the height above the first drainage cell each flow path
    reaches, measured on ``dem`` itself so breach carving never leaks into it. Every
    WhiteboxTools step must leave a non-empty output file; a tool that reports
    success without writing one raises ``RuntimeError``.
    """
    import whitebox

    out_dir.mkdir(parents=True, exist_ok=True)
    wbt = whitebox.WhiteboxTools()
    wbt.set_verbose_mode(False)

    def path(name: str) -> str:
        return str((out_dir / f"{name}.tif").resolve())

    def run(tool_name: str, *inputs: str, output: str, **options) -> None:
        messages: list[str] = []
        tool = getattr(wbt, tool_name)
        status = tool(*inputs, output, callback=messages.append, **options)
        produced = Path(output)
        if status != 0 or not produced.exists() or produced.stat().st_size == 0:
            tail = " | ".join(m.strip() for m in messages[-5:] if m.strip())
            detail = f": {tail}" if tail else ""
            raise RuntimeError(
                f"WhiteboxTools {tool_name} did not produce {produced.name}{detail}"
            )

    with rasterio.open(dem) as src:
        cell_area = abs(src.res[0] * src.res[1])
    threshold_cells = max(1.0, stream_area_km2 * 1e6 / cell_area)

    breached = path("dem_breached")
    pointer = path("d8_pointer")
    # Fast breaching (Lindsay 2016) with pit filling; least-cost breaching did not
    # finish in 45 min over the statewide 10 m grid and gives near-identical HAND.
    run(
        "breach_depressions",
        str(Path(dem).resolve()),
        output=breached,
        fill_pits=True,
    )
    run("d8_pointer", breached, output=pointer)
    run(
        "d8_flow_accumulation",
        pointer,
        output=path("flow_acc"),
        out_type="cells",
        pntr=True,
    )
    run(
        "d8_flow_accumulation",
        pointer,
        output=path("sca"),
        out_type="specific contributing area",
        pntr=True,
    )
    run(
        "extract_streams",
        path("flow_acc"),
        output=path("streams"),
        threshold=threshold_cells,
        zero_background=False,
    )
    if water is None:
        run("elevation_above_stream", breached, path("streams"), output=path("hand"))
    else:
        _hand_with_water(run, path, Path(dem), water)
    run("slope", str(dem.resolve()), output=path("slope"), units="degrees")
    run("wetness_index", path("sca"), path("slope"), output=path("twi"))

    names = ("hand", "slope", "flow_acc", "twi", "streams")
    return {name: out_dir / f"{name}.tif" for name in names}


# Watershed IDs encode the drainage cell elevation in centimetres; the offset
# keeps them positive (WhiteboxTools ignores zero outlets).
_ID_OFFSET_M = 1000.0


def _hand_with_water(run, path, dem: Path, water: Path) -> None:
    """HAND against streams + water, measured on the conditioned ``dem``.

    Each drainage cell becomes a watershed outlet whose ID encodes its own
    elevation, so labelling the D8 field tells every cell the elevation of the
    first drainage cell downstream.
    """

    def outlets(d):
        is_water = d["water"] == 1
        streams = (d["streams"] > 0) & (d["streams"] != d["streams_nodata"])
        valid = d["dem"] != d["dem_nodata"]
        channel = (is_water | streams) & valid
        ids = np.round((d["dem"] + _ID_OFFSET_M) * 100.0)
        return {
            "drainage": np.where(channel, 1, NODATA),
            "outlets": np.where(channel, ids, 0),
        }

    _map_strips(
        {"dem": (dem, 1), "streams": (Path(path("streams")), 1), "water": (water, 1)},
        {
            "drainage": (
                Path(path("drainage")),
                {"dtype": "float32", "nodata": NODATA},
            ),
            "outlets": (Path(path("outlets")), {"dtype": "float32", "nodata": NODATA}),
        },
        outlets,
    )
    run("watershed", path("d8_pointer"), path("outlets"), output=path("drains_to"))

    def height(d):
        label = d["label"]
        reached = np.isfinite(label) & (label > 0) & (label != d["label_nodata"])
        valid = d["dem"] != d["dem_nodata"]
        target = label / 100.0 - _ID_OFFSET_M
        hand = np.where(reached & valid, np.maximum(d["dem"] - target, 0.0), NODATA)
        return {"hand": np.where(valid & (d["drainage"] == 1), 0.0, hand)}

    _map_strips(
        {
            "dem": (dem, 1),
            "label": (Path(path("drains_to")), 1),
            "drainage": (Path(path("drainage")), 1),
        },
        {"hand": (Path(path("hand")), {"dtype": "float32", "nodata": NODATA})},
        height,
    )
    Path(path("drainage")).replace(path("streams"))
    for name in ("outlets", "drains_to"):
        Path(path(name)).unlink()

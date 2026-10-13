"""Command line entry point: ``python -m backend.floodmodel <step>``."""

from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

from backend.floodmodel import lidar, terrain

WORK_DIR = Path(".cache/floodmodel")


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(prog="python -m backend.floodmodel")
    parser.add_argument("--work-dir", type=Path, default=WORK_DIR)
    steps = parser.add_subparsers(dest="step", required=True)
    steps.add_parser("lidar-index", help="Fetch the INEGI LiDAR tile index")
    download = steps.add_parser("lidar-download", help="Download LiDAR tile ZIPs")
    download.add_argument("--workers", type=int, default=4)
    mosaic = steps.add_parser("terrain-mosaic", help="Merge LiDAR tiles into one DEM")
    mosaic.add_argument("--resolution", type=float, default=10.0)
    derive = steps.add_parser("terrain-derivatives", help="HAND, slope, TWI, flow")
    derive.add_argument("--resolution", type=float, default=10.0)
    derive.add_argument("--stream-area-km2", type=float, default=1.0)
    derive.add_argument("--conditioned", action="store_true")
    steps.add_parser("inventory", help="Download CENAPRED flood inventory layers")
    aux = steps.add_parser("terrain-aux", help="Earth Engine layers for conditioning")
    aux.add_argument("--resolution", type=float, default=15.0)
    cond = steps.add_parser("terrain-condition", help="Fill gaps and mark water")
    cond.add_argument("--resolution", type=float, default=15.0)
    steps.add_parser("boundaries", help="Municipality boundaries (FAO GAUL 2025)")
    stack = steps.add_parser(
        "stack", help="Terrain + Earth Engine features on one grid"
    )
    stack.add_argument("--terrain-resolution", type=float, default=15.0)
    stack.add_argument("--resolution", type=float, default=30.0)
    steps.add_parser("labels", help="Flooded / dry / excluded cells from CENAPRED")
    seasons = steps.add_parser("s1-seasons", help="Sentinel-1 flood season per year")
    seasons.add_argument("--first", type=int, default=2015)
    seasons.add_argument("--last", type=int, default=2025)
    steps.add_parser("final", help="Train both models and build the ensemble map")
    steps.add_parser("validate", help="Score held-out models on unseen floods")
    pub = steps.add_parser("publish", help="Classes, XYZ tiles and stats for the app")
    pub.add_argument("--out", type=Path, default=Path("backend/data/flood_risk"))
    features = steps.add_parser("gee-features", help="Earth Engine layers on the grid")
    features.add_argument("--resolution", type=float, default=30.0)
    args = parser.parse_args(argv)

    index_path = args.work_dir / "lidar" / "index.json"
    if args.step == "lidar-index":
        tiles = lidar.tiles_from_rows(lidar.fetch_catalog_rows())
        lidar.write_index(tiles, index_path)
        print(f"LiDAR index: {len(tiles)} tiles -> {index_path}")
        return 0
    if args.step == "lidar-download":
        tiles = lidar.read_index(index_path)
        summary = lidar.download_tiles(
            tiles, args.work_dir / "lidar" / "zips", workers=args.workers
        )
        print(
            f"LiDAR download: {summary['downloaded']} downloaded, "
            f"{summary['skipped']} already present, {len(summary['failed'])} failed"
        )
        if summary["failed"]:
            print("Failed sheets: " + ", ".join(summary["failed"]), file=sys.stderr)
            return 1
        return 0
    if args.step == "terrain-mosaic":
        zips = sorted((args.work_dir / "lidar" / "zips").glob("*.zip"))
        grids = [
            terrain.extract_grid(z, args.work_dir / "lidar" / "grids") for z in zips
        ]
        out = terrain.mosaic(
            grids,
            _dem_path(args.work_dir, args.resolution),
            resolution=args.resolution,
            crs=terrain.LIDAR_CRS,
        )
        print(f"DEM mosaic: {len(grids)} tiles -> {out}")
        return 0
    if args.step == "terrain-derivatives":
        dem = _dem_path(args.work_dir, args.resolution)
        out_dir = args.work_dir / "terrain" / f"{args.resolution:g}m"
        water = None
        if args.conditioned:
            cond_dir = args.work_dir / "terrain" / f"conditioned_{args.resolution:g}m"
            dem, water = cond_dir / "dem_conditioned.tif", cond_dir / "water.tif"
        outputs = terrain.derivatives(
            dem, out_dir, stream_area_km2=args.stream_area_km2, water=water
        )
        print("Terrain derivatives: " + ", ".join(sorted(outputs)) + f" -> {out_dir}")
        return 0
    if args.step == "inventory":
        from backend.floodmodel import cenapred

        layers = {**cenapred.FLOOD_EVENTS, **cenapred.SUSCEPTIBILITY_REFERENCES}
        for name, layer_id in layers.items():
            out = cenapred.fetch_layer(
                layer_id, args.work_dir / "inventory" / f"{name}.geojson"
            )
            print(f"Inventory {name}: {out}")
        return 0
    if args.step == "terrain-aux":
        import ee

        from backend import config
        from backend.floodmodel import gee_layers

        ee.Initialize(project=config.GEE_PROJECT)
        dem = _dem_path(args.work_dir, args.resolution)
        grid = gee_layers.Grid.from_raster(dem, res=args.resolution)
        out = gee_layers.download(
            gee_layers.ee_compute(gee_layers.aux_image()),
            gee_layers.AUX_BANDS,
            grid,
            args.work_dir / "terrain" / f"aux_{args.resolution:g}m.tif",
        )
        print(f"Terrain aux: {grid.width}x{grid.height} -> {out}")
        return 0
    if args.step == "terrain-condition":
        res = args.resolution
        out = terrain.condition(
            _dem_path(args.work_dir, res),
            args.work_dir / "terrain" / f"aux_{res:g}m.tif",
            args.work_dir / "terrain" / f"conditioned_{res:g}m",
        )
        print(
            f"Conditioned DEM (LiDAR-MERIT bias {out['bias_m']:.2f} m) -> {out['dem']}"
        )
        return 0
    if args.step == "boundaries":
        import ee

        from backend import config
        from backend.floodmodel import gee_layers

        ee.Initialize(project=config.GEE_PROJECT)
        out = args.work_dir / "boundaries" / "municipalities.geojson"
        out.parent.mkdir(parents=True, exist_ok=True)
        data = gee_layers.fetch_boundaries()
        out.write_text(json.dumps(data))
        print(f"Boundaries: {len(data['features'])} municipalities -> {out}")
        return 0
    if args.step == "stack":
        from backend.floodmodel import model

        tdir = args.work_dir / "terrain" / f"{args.terrain_resolution:g}m"
        dem = (
            args.work_dir
            / "terrain"
            / f"conditioned_{args.terrain_resolution:g}m"
            / "dem_conditioned.tif"
        )
        out = model.stack_features(
            {
                "elevation": (dem, "average"),
                "hand": (tdir / "hand.tif", "average"),
                "hand_min": (tdir / "hand.tif", "min"),
                "slope": (tdir / "slope.tif", "average"),
                "twi": (tdir / "twi.tif", "average"),
                "flow_acc": (tdir / "flow_acc.tif", "max"),
            },
            args.work_dir / "features" / f"gee_{args.resolution:g}m.tif",
            args.work_dir / "features" / f"stack_{args.resolution:g}m.tif",
        )
        print(f"Feature stack -> {out}")
        return 0
    if args.step == "labels":
        from shapely.geometry import mapping, shape
        from shapely.ops import unary_union

        from backend.floodmodel import cenapred, model

        bounds = json.loads(
            (args.work_dir / "boundaries" / "municipalities.geojson").read_text()
        )
        state = mapping(unary_union([shape(f["geometry"]) for f in bounds["features"]]))
        events = [
            args.work_dir / "inventory" / f"{name}.geojson"
            for name in cenapred.FLOOD_EVENTS
        ]
        out = model.label_raster(
            events,
            args.work_dir / "features" / "stack_30m.tif",
            args.work_dir / "features" / "labels_30m.tif",
            state=state,
        )
        print(f"Labels -> {out}")
        return 0
    if args.step == "s1-seasons":
        import ee

        from backend import config
        from backend.floodmodel import gee_layers

        ee.Initialize(project=config.GEE_PROJECT)
        years = list(range(args.first, args.last + 1))
        grid = gee_layers.Grid.from_raster(_dem_path(args.work_dir, 15), res=30)
        region = ee.Geometry.Rectangle([-94.2, 17.2, -90.9, 18.75])
        image = gee_layers.s1_season_image(years, region)
        out = gee_layers.download(
            gee_layers.ee_compute(image),
            [f"s1_{y}" for y in years],
            grid,
            args.work_dir / "features" / "s1_seasons_30m.tif",
        )
        print(f"Sentinel-1 seasons {years[0]}-{years[-1]} -> {out}")
        return 0
    if args.step == "final":
        from backend.floodmodel import pipeline

        print(f"Susceptibility -> {pipeline.final(args.work_dir)}")
        return 0
    if args.step == "publish":
        from backend.floodmodel import publish

        result = publish.publish(args.work_dir, args.out)
        print(f"Published {result['tiles']} tiles -> {args.out}")
        print(f"Class breaks: {result['breaks']}")
        return 0
    if args.step == "validate":
        from backend.floodmodel import pipeline

        scores = pipeline.validate(args.work_dir)["scores"]
        for source, events in scores.items():
            cells = "  ".join(
                f"{e} {m['roc_auc']:.3f}/{m['pr_auc']:.3f}" for e, m in events.items()
            )
            print(f"{source:16s} {cells}")
        return 0
    if args.step == "gee-features":
        import ee

        from backend import config
        from backend.floodmodel import gee_layers

        ee.Initialize(project=config.GEE_PROJECT)
        grid = gee_layers.Grid.from_raster(
            _dem_path(args.work_dir, 10.0), res=args.resolution
        )
        out = gee_layers.download(
            gee_layers.ee_compute(gee_layers.feature_image()),
            gee_layers.FEATURE_BANDS,
            grid,
            args.work_dir / "features" / f"gee_{args.resolution:g}m.tif",
        )
        print(f"GEE features: {grid.width}x{grid.height} -> {out}")
        return 0
    return 2


def _dem_path(work_dir: Path, resolution: float) -> Path:
    return work_dir / "terrain" / f"dem_{resolution:g}m.tif"


if __name__ == "__main__":
    raise SystemExit(main())

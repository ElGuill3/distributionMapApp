"""Command line entry point: ``python -m backend.floodmodel <step>``."""

from __future__ import annotations

import argparse
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

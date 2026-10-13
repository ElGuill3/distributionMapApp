"""Command line entry point: ``python -m backend.floodmodel <step>``."""

from __future__ import annotations

import argparse
import sys
from pathlib import Path

from backend.floodmodel import lidar

WORK_DIR = Path(".cache/floodmodel")


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(prog="python -m backend.floodmodel")
    parser.add_argument("--work-dir", type=Path, default=WORK_DIR)
    steps = parser.add_subparsers(dest="step", required=True)
    steps.add_parser("lidar-index", help="Fetch the INEGI LiDAR tile index")
    download = steps.add_parser("lidar-download", help="Download LiDAR tile ZIPs")
    download.add_argument("--workers", type=int, default=4)
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
    return 2


if __name__ == "__main__":
    raise SystemExit(main())

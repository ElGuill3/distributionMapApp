"""Refresh station CSVs safely before Flask imports its station catalog.

Use the existing CONAGUA downloader without starting its periodic scheduler.
Downloads are staged: invalid responses never replace available local data.
"""

from __future__ import annotations

import argparse
import csv
import io
import logging
import math
import os
import sys
import tempfile
from datetime import datetime
from pathlib import Path

from backend.scrapers.conagua import ConaguaScraper
from config import (
    BASE_DIR,
    CONAGUA_CLIMAS_STATIONS,
    CONAGUA_HIDROS_STATIONS,
    STATION_COORDS,
)

logger = logging.getLogger(__name__)


def _usable_csv(
    path: Path, category: str, station: str | None = None, *, diagnostics: bool = False
) -> str | None:
    """Require visible station metadata and at least one actual observation."""

    def rejected(reason: str) -> None:
        if diagnostics:
            logger.warning(
                "Stations: %s/%s unavailable: %s",
                category,
                station or path.stem,
                reason,
            )

    if not path.is_file():
        rejected("no file downloaded")
        return None
    try:
        try:
            content = path.read_text(encoding="utf-8")
        except UnicodeDecodeError:
            content = path.read_text(encoding="latin-1")
        # requests.text may interpret UTF-8 CONAGUA bytes as Latin-1. Repair
        # only lines whose Latin-1 -> UTF-8 conversion is lossless, matching
        # the application's metadata/column reader. Valid accents stay intact.
        normalized = []
        for line in content.splitlines(keepends=True):
            try:
                normalized.append(line.encode("latin-1").decode("utf-8"))
            except (UnicodeEncodeError, UnicodeDecodeError):
                normalized.append(line)
        content = "".join(normalized)
        lines = content.splitlines()
        metadata = {
            key.strip().lower(): value.strip()
            for line in lines[:6]
            if ":" in line
            for key, value in [line.split(":", 1)]
        }
        key = next((v for k, v in metadata.items() if "clave" in k), "")
        name = next((v for k, v in metadata.items() if "estac" in k), "")
        if not name or not key:
            rejected("invalid station metadata")
            return None
        if key.upper() not in STATION_COORDS:
            rejected("no known station coordinates")
            return None
        if station is not None and key.upper() != station.upper():
            rejected("station identifier mismatch")
            return None
        header = next((i for i, line in enumerate(lines) if "Fecha" in line), None)
        if header is None:
            rejected("missing Fecha header")
            return None
        reader = csv.DictReader(io.StringIO("\n".join(lines[header:])), strict=True)
        columns = [column.strip() for column in (reader.fieldnames or [])]
        reader.fieldnames = columns
        if "Fecha" not in columns:
            rejected("missing Fecha column")
            return None
        metric = "precipitacion" if category == "climas" else "nivel"
        column = next(
            (
                column
                for column in columns
                if metric in column.lower().replace("ó", "o").replace("í", "i")
            ),
            None,
        )
        if column is None:
            rejected(f"missing recognized {metric} column; check CSV encoding")
            return None
        has_observation = False
        for row in reader:
            # DictReader exposes extra fields under None; pandas rejects these
            # rows. Validate the entire response, not just its first observation.
            if None in row:
                rejected("malformed CSV row with extra fields")
                return None
            try:
                value = float(row[column])
                date = row["Fecha"].strip()
                try:
                    datetime.fromisoformat(date)
                except ValueError:
                    for pattern in (
                        "%m/%d/%Y",
                        "%d/%m/%Y",
                        "%Y/%m/%d",
                        "%m/%d/%Y %H:%M:%S",
                    ):
                        try:
                            datetime.strptime(date, pattern)
                            break
                        except ValueError:
                            continue
                    else:
                        continue
                if math.isfinite(value):
                    has_observation = True
            except (ValueError, TypeError, AttributeError):
                continue
        if has_observation:
            return content
        rejected("no valid dated measurement")
    except (OSError, ValueError, KeyError, StopIteration, TypeError, csv.Error) as exc:
        rejected(f"CSV read or validation error ({type(exc).__name__})")
    return None


def main(argv: list[str] | None = None) -> int:
    argparse.ArgumentParser(description=__doc__).parse_args(argv)
    logging.basicConfig(
        level=logging.INFO, format="%(levelname)s %(name)s: %(message)s"
    )
    root = BASE_DIR / "data" / "stations"
    root.mkdir(parents=True, exist_ok=True)
    refreshed = 0
    failures = []
    # The staging directory is on the destination filesystem for atomic moves.
    with tempfile.TemporaryDirectory(prefix=".bootstrap-", dir=root) as temporary:
        for category, configured in (
            ("hidros", CONAGUA_HIDROS_STATIONS),
            ("climas", CONAGUA_CLIMAS_STATIONS),
        ):
            stations = list(dict.fromkeys(s.upper() for s in configured if s))
            if not stations:
                continue
            staging = Path(temporary) / category
            scraper = ConaguaScraper(category, stations, output_dir=staging)
            logger.info("Stations: refreshing %s/%s", category, ",".join(stations))
            try:
                scraper.scrape()
            except Exception as exc:
                # Log the error type, not arbitrary transport details or secrets.
                logger.warning(
                    "Stations: %s downloader failed (%s)", category, type(exc).__name__
                )
            for station in stations:
                source = staging / f"{station}.csv"
                content = _usable_csv(source, category, station, diagnostics=True)
                if content is None:
                    failures.append(f"{category}/{station}")
                    continue
                destination = root / category / source.name
                destination.parent.mkdir(parents=True, exist_ok=True)
                # Normalize downloaded encodings for the application's CSV reader.
                source.write_text(content, encoding="utf-8")
                os.replace(source, destination)
                refreshed += 1

    usable = sum(
        _usable_csv(path, "climas" if path.parent.name == "climas" else "hidros")
        is not None
        for path in root.rglob("*.csv")
        if path.parent.name in {"hidros", "climas", "stations"}
    )
    if not usable:
        print(
            "Station bootstrap failed: no usable station data is available. "
            "Check CONAGUA connectivity and station configuration, then retry.",
            file=sys.stderr,
        )
        return 2
    if failures:
        print(
            "Warning: station downloads unavailable or invalid for "
            f"{', '.join(failures)}; using available local station data.",
            file=sys.stderr,
        )
    print(f"Stations: {refreshed} refreshed; {usable} usable.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())

"""INEGI LiDAR 5 m terrain tiles for Tabasco: catalog index and downloads.

Source: INEGI, Modelos Digitales de Elevación de Alta Resolución LiDAR, Terreno,
5 m (2012). Free use with credit under INEGI's "Términos de Libre Uso".
"""

from __future__ import annotations

import json
import time
import urllib.request
import zipfile
from collections.abc import Callable, Iterable
from concurrent.futures import ThreadPoolExecutor
from dataclasses import asdict, dataclass
from pathlib import Path

INEGI_HOST = "https://www.inegi.org.mx"
CATALOG_URL = f"{INEGI_HOST}/app/api/productos/interna_v2/mapas/lista/resultados"
TABASCO_ENTITY = "27"
LIDAR_TERRAIN_5M_TITLE = 1016
_CATALOG_QUERY = {
    "enti": TABASCO_ENTITY,
    "muni": None,
    "loca": None,
    "tema": None,
    "titg": LIDAR_TERRAIN_5M_TITLE,
    "esca": None,
    "edic": None,
    "form": None,
    "prog": None,
    "busc": None,
    "tipoB": 1,
    "adv": False,
    "rango": None,
    "sens": None,
    "uedo": None,
    "reso": None,
    "point": None,
    "malla": None,
    "poligono": None,
    "buscAG": None,
    "orden": 1,
    "desc": False,
}


@dataclass(frozen=True)
class Tile:
    sheet: str
    upc: str
    url: str


def _post_json(body: dict) -> dict:
    request = urllib.request.Request(
        CATALOG_URL,
        data=json.dumps(body).encode(),
        headers={"Content-Type": "application/json"},
    )
    with urllib.request.urlopen(request, timeout=60) as response:
        return json.load(response)


def fetch_catalog_rows(
    post: Callable[[dict], dict] = _post_json, page_size: int = 50
) -> list[dict]:
    """Return every catalog row, paging until an empty or failed page."""
    rows: list[dict] = []
    page = 1
    while True:
        result = post({**_CATALOG_QUERY, "pag": page, "tam": page_size})
        batch = result.get("list", {}).get("mapas", []) if result.get("success") else []
        if not batch:
            return rows
        rows.extend(batch)
        page += 1


def tiles_from_rows(rows: Iterable[dict]) -> list[Tile]:
    """Keep one GRID download per map sheet, sorted by sheet key."""
    tiles: dict[str, Tile] = {}
    for row in rows:
        for fmt in row.get("formatos", []):
            if fmt.get("extension") == "GRID":
                path = fmt["url"]["valor"]
                tiles[row["clave_carta"]] = Tile(
                    row["clave_carta"], row["key"], f"{INEGI_HOST}{path}"
                )
    return sorted(tiles.values(), key=lambda tile: tile.sheet)


def write_index(tiles: list[Tile], path: Path) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps([asdict(t) for t in tiles], indent=1), encoding="utf-8")


def read_index(path: Path) -> list[Tile]:
    return [Tile(**item) for item in json.loads(path.read_text(encoding="utf-8"))]


def _fetch_bytes(url: str) -> bytes:
    with urllib.request.urlopen(url, timeout=120) as response:
        return response.read()


def _is_valid_zip(path: Path) -> bool:
    try:
        with zipfile.ZipFile(path) as archive:
            return archive.testzip() is None
    except (zipfile.BadZipFile, OSError):
        return False


def download_tiles(
    tiles: list[Tile],
    out_dir: Path,
    *,
    fetch: Callable[[str], bytes] = _fetch_bytes,
    workers: int = 4,
    retries: int = 3,
    backoff_s: float = 2.0,
) -> dict:
    """Download missing or corrupt tile ZIPs; never keep partial files.

    Valid ZIPs already on disk are skipped, so interrupted runs resume.
    """
    out_dir.mkdir(parents=True, exist_ok=True)

    def one(tile: Tile) -> str:
        target = out_dir / f"{tile.sheet}.zip"
        if target.exists() and _is_valid_zip(target):
            return "skipped"
        partial = target.with_suffix(".zip.part")
        for attempt in range(1, retries + 1):
            try:
                partial.write_bytes(fetch(tile.url))
                if _is_valid_zip(partial):
                    partial.replace(target)
                    return "downloaded"
            except OSError:
                pass
            partial.unlink(missing_ok=True)
            if attempt < retries and backoff_s:
                time.sleep(backoff_s * attempt)
        target.unlink(missing_ok=True)
        return "failed"

    with ThreadPoolExecutor(max_workers=workers) as pool:
        outcomes = list(pool.map(one, tiles))
    return {
        "skipped": outcomes.count("skipped"),
        "downloaded": outcomes.count("downloaded"),
        "failed": [t.sheet for t, o in zip(tiles, outcomes) if o == "failed"],
    }

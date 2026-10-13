"""INEGI Continuo de Elevaciones Mexicano (CEM 3.0), 15 m, by state.

The CEM covers every state completely, unlike the LiDAR flights, so it fills
LiDAR coverage gaps at the working resolution (instead of ~90 m MERIT).
Source: INEGI, Continuo de Elevaciones Mexicano 3.0.
"""

from __future__ import annotations

import io
import urllib.parse
import urllib.request
import zipfile
from collections.abc import Callable
from pathlib import Path

DOWNLOAD_URL = "https://www.inegi.org.mx/app/geo2/elevacionesmex/DownloadFile.do"
BUILD_TAG = "20170619"  # CEM V3 package build used in INEGI's file names


def state_url(state: str, code: str, resolution: int = 15) -> str:
    """Download URL of one state's CEM 3.0 package (15 m is a TIF ZIP)."""
    suffix = "_TIF" if resolution == 15 else ""
    query = urllib.parse.urlencode(
        {
            "file": f"CEM_V3_{BUILD_TAG}_R{resolution}_E{code}{suffix}.zip",
            "res": resolution,
            "entidad": state,
        }
    )
    return f"{DOWNLOAD_URL}?{query}"


def _fetch(url: str) -> bytes:
    with urllib.request.urlopen(url, timeout=600) as response:
        return response.read()


def download(
    state: str,
    code: str,
    out_dir: Path,
    *,
    resolution: int = 15,
    fetch: Callable[[str], bytes] = _fetch,
) -> Path:
    """Download and extract the state's CEM; return its GeoTIFF (cached)."""
    existing = sorted(out_dir.glob(f"*_r{resolution}m.tif"))
    if existing:
        return existing[0]
    data = fetch(state_url(state, code, resolution))
    if not zipfile.is_zipfile(io.BytesIO(data)):
        raise RuntimeError(f"CEM download for {state} is not a ZIP archive")
    out_dir.mkdir(parents=True, exist_ok=True)
    with zipfile.ZipFile(io.BytesIO(data)) as archive:
        for member in archive.infolist():
            name = Path(member.filename).name
            if not name or member.is_dir():
                continue
            (out_dir / name).write_bytes(archive.read(member))
    tifs = sorted(out_dir.glob(f"*_r{resolution}m.tif"))
    if not tifs:
        raise RuntimeError(f"CEM package for {state} has no *_r{resolution}m.tif")
    return tifs[0]

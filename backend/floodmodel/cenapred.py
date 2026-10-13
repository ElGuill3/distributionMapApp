"""CENAPRED flood inventory for Tabasco (Atlas Nacional de Riesgos, ArcGIS REST).

Observed flood extents label the susceptibility model; CENAPRED/PNUD
susceptibility layers are kept only for independent comparison.
Source: CENAPRED, Atlas Estatal de Riesgos — Tabasco.
"""

from __future__ import annotations

import json
import time
import urllib.parse
import urllib.request
from collections.abc import Callable
from pathlib import Path

from shapely.geometry import LinearRing, MultiPolygon, Polygon, mapping

SERVICE = (
    "http://servicios2.cenapred.unam.mx:6080/arcgis/rest/services/"
    "AtlasEstatales/MapaTabasco/MapServer"
)

# Observed flood extents (labels) and official susceptibility maps (comparison).
FLOOD_EVENTS = {
    "flood_2011_10_22": 88,
    "flood_2020_06_cristobal": 91,
    "flood_2020_10_28_s1": 102,
    "flood_2020_11_05_s1": 103,
    "flood_2020_11_07_tsx": 104,
    "flood_2020_copernicus": 113,
}
# Layers whose full-resolution geometry makes the server fail (HTTP 500); they
# are generalized server-side by this many degrees (~33 m, below the 30 m grid).
GENERALIZE_DEGREES = {113: 0.0003}
SUSCEPTIBILITY_REFERENCES = {
    "susceptibility_pnud_2018": 115,
    "susceptibility_ipcet_pnud_2022": 131,
}


def _get_json(url: str, params: dict) -> dict:
    query = urllib.parse.urlencode(params)
    for attempt in range(1, 4):
        try:
            with urllib.request.urlopen(f"{url}?{query}", timeout=180) as response:
                return json.load(response)
        except (OSError, json.JSONDecodeError):
            if attempt == 3:
                raise
            time.sleep(5 * attempt)
    raise RuntimeError("unreachable")


def rings_to_geometry(rings: list[list[list[float]]]) -> Polygon | MultiPolygon | None:
    """Convert ArcGIS rings (outer clockwise, holes counter-clockwise)."""
    shells: list[list] = []
    for coords in rings:
        if len(coords) < 4:
            continue
        ring = LinearRing(coords)
        if ring.is_ccw:  # hole: attach to the containing shell
            hole_poly = Polygon(coords)
            for shell in reversed(shells):
                if Polygon(shell[0]).contains(hole_poly.representative_point()):
                    shell[1].append(coords)
                    break
        else:
            shells.append([coords, []])
    polygons = [Polygon(shell, holes) for shell, holes in shells]
    polygons = [p if p.is_valid else p.buffer(0) for p in polygons]
    polygons = [p for p in polygons if not p.is_empty and p.area > 0]
    if not polygons:
        return None
    if len(polygons) == 1:
        return polygons[0]
    parts: list[Polygon] = []
    for poly in polygons:
        parts.extend(poly.geoms if isinstance(poly, MultiPolygon) else [poly])
    return MultiPolygon(parts)


def fetch_layer(
    layer_id: int,
    output: Path,
    *,
    get: Callable[[str, dict], dict] = _get_json,
    chunk: int = 200,
) -> Path:
    """Download one polygon layer as GeoJSON in WGS 84 (skipped if present).

    A server error aborts the download without writing ``output``, so a later
    run retries the layer instead of skipping an empty file.
    """
    if output.exists():
        return output
    url = f"{SERVICE}/{layer_id}/query"
    ids = sorted(
        get(url, {"where": "1=1", "returnIdsOnly": "true", "f": "json"})["objectIds"]
        or []
    )
    features = []
    for start in range(0, len(ids), chunk):
        batch = ids[start : start + chunk]
        params = {
            "objectIds": ",".join(str(i) for i in batch),
            "outFields": "*",
            "returnGeometry": "true",
            "outSR": "4326",
            "f": "json",
        }
        if layer_id in GENERALIZE_DEGREES:
            params["maxAllowableOffset"] = str(GENERALIZE_DEGREES[layer_id])
        data = get(url, params)
        if "error" in data:
            message = data["error"].get("message", data["error"])
            raise RuntimeError(f"CENAPRED layer {layer_id} query failed: {message}")
        for feature in data.get("features", []):
            geometry = rings_to_geometry(feature.get("geometry", {}).get("rings", []))
            if geometry is not None:
                features.append(
                    {
                        "type": "Feature",
                        "properties": feature.get("attributes", {}),
                        "geometry": mapping(geometry),
                    }
                )
    features.sort(key=lambda f: f["properties"].get("OBJECTID", 0))
    output.parent.mkdir(parents=True, exist_ok=True)
    partial = output.with_suffix(".part")
    partial.write_text(json.dumps({"type": "FeatureCollection", "features": features}))
    partial.replace(output)
    return output

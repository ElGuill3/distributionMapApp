"""CENAPRED flood inventory: ArcGIS REST paging and polygon conversion."""

import json

import pytest

shapely = pytest.importorskip(
    "shapely", reason="floodmodel dependency group not installed"
)

from backend.floodmodel import cenapred  # noqa: E402

# ArcGIS: outer rings clockwise, holes counter-clockwise.
OUTER_CW = [[0, 0], [0, 10], [10, 10], [10, 0], [0, 0]]
HOLE_CCW = [[2, 2], [4, 2], [4, 4], [2, 4], [2, 2]]
SECOND_CW = [[20, 0], [20, 5], [25, 5], [25, 0], [20, 0]]


def test_rings_to_geometry_keeps_holes_and_multiple_parts():
    geom = cenapred.rings_to_geometry([OUTER_CW, HOLE_CCW, SECOND_CW])

    assert geom.geom_type == "MultiPolygon"
    assert geom.area == pytest.approx(100 - 4 + 25)
    assert not geom.contains(shapely.Point(3, 3))
    assert geom.contains(shapely.Point(5, 5))


def test_rings_to_geometry_drops_empty_or_degenerate_input():
    assert cenapred.rings_to_geometry([]) is None
    assert cenapred.rings_to_geometry([[[0, 0], [1, 1], [0, 0]]]) is None


def test_fetch_layer_pages_object_ids_and_requests_wgs84(tmp_path):
    calls = []

    def get(url, params):
        calls.append(params)
        if params.get("returnIdsOnly") == "true":
            return {"objectIds": [3, 1, 2]}
        ids = [int(i) for i in params["objectIds"].split(",")]
        return {
            "features": [
                {"attributes": {"OBJECTID": i}, "geometry": {"rings": [OUTER_CW]}}
                for i in ids
            ]
        }

    out = cenapred.fetch_layer(
        102, tmp_path / "s1_2020_10_28.geojson", get=get, chunk=2
    )

    data = json.loads(out.read_text())
    assert [f["properties"]["OBJECTID"] for f in data["features"]] == [1, 2, 3]
    assert {f["geometry"]["type"] for f in data["features"]} == {"Polygon"}
    feature_calls = [c for c in calls if "objectIds" in c]
    assert [c["objectIds"] for c in feature_calls] == ["1,2", "3"]
    assert all(c["outSR"] == "4326" for c in feature_calls)


def test_fetch_layer_skips_existing_output(tmp_path):
    out = tmp_path / "done.geojson"
    out.write_text('{"type": "FeatureCollection", "features": []}')

    def get(url, params):
        raise AssertionError("must not hit the network")

    assert cenapred.fetch_layer(91, out, get=get) == out


def test_fetch_layer_server_error_raises_and_writes_nothing(tmp_path):
    out = tmp_path / "copernicus.geojson"

    def get(url, params):
        if params.get("returnIdsOnly") == "true":
            return {"objectIds": [1]}
        return {"error": {"code": 500, "message": "Error performing query operation"}}

    with pytest.raises(RuntimeError, match="layer 113.*Error performing query"):
        cenapred.fetch_layer(113, out, get=get)
    assert not out.exists()
    assert not out.with_suffix(".part").exists()


def test_fetch_layer_generalizes_only_layers_that_need_it(tmp_path):
    seen = {}

    def get(url, params):
        if params.get("returnIdsOnly") == "true":
            return {"objectIds": [1]}
        seen[url.rsplit("/", 2)[-2]] = params.get("maxAllowableOffset")
        return {"features": [{"attributes": {}, "geometry": {"rings": [OUTER_CW]}}]}

    cenapred.fetch_layer(113, tmp_path / "a.geojson", get=get)
    cenapred.fetch_layer(102, tmp_path / "b.geojson", get=get)

    assert seen == {"113": "0.0003", "102": None}

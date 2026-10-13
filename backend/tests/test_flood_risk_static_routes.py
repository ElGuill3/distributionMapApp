"""Static flood susceptibility artifacts: metadata, municipalities and XYZ tiles."""

from pathlib import Path

import pytest

from backend import config

TILES = Path(config.FLOOD_RISK_DIR) / "tiles"


@pytest.fixture
def client():
    from backend.app import app

    app.config["TESTING"] = True
    return app.test_client()


def _existing_tile(zoom: int) -> str:
    tile = next(TILES.glob(f"{zoom}/*/*.png"), None)
    if tile is None:
        pytest.fail(f"no published tile at zoom {zoom}: run `python -m backend.floodmodel publish`")
    return f"/api/flood-risk/tiles/{zoom}/{tile.parent.name}/{tile.name}"


def test_metadata_lists_five_classes_and_tile_template(client):
    response = client.get("/api/flood-risk/metadata")

    assert response.status_code == 200
    data = response.get_json()
    assert [c["value"] for c in data["classes"]] == [1, 2, 3, 4, 5]
    assert data["tiles"]["url"] == "/api/flood-risk/tiles/{z}/{x}/{y}.png"
    assert data["tiles"]["maxzoom"] == 12
    assert response.headers["Cache-Control"] == "public, max-age=86400"


def test_municipalities_cover_all_seventeen_with_stats(client):
    response = client.get("/api/flood-risk/municipalities")

    assert response.status_code == 200
    features = response.get_json()["features"]
    assert len(features) == 17
    names = {f["properties"]["name"] for f in features}
    assert {"Teapa", "Centro", "Jalpa De Méndez"} <= names
    for feature in features:
        props = feature["properties"]
        assert sum(props["class_share"]) == pytest.approx(1.0, abs=1e-3)
        assert 1 <= props["rank"] <= 17


@pytest.mark.parametrize("zoom", range(7, 13))
def test_tile_is_served_as_cached_png(client, zoom):
    response = client.get(_existing_tile(zoom))

    assert response.status_code == 200
    assert response.mimetype == "image/png"
    assert response.data[:8] == b"\x89PNG\r\n\x1a\n"
    assert response.headers["Cache-Control"] == "public, max-age=86400"


def test_tile_outside_the_published_set_is_not_found(client):
    response = client.get("/api/flood-risk/tiles/3/0/0.png")

    assert response.status_code == 404


@pytest.mark.parametrize(
    "path",
    [
        "/api/flood-risk/tiles/10/..%2F..%2Fmetadata/1.png",
        "/api/flood-risk/tiles/10/1/..%2F1.png",
        "/api/flood-risk/tiles/a/1/1.png",
    ],
)
def test_tile_route_only_accepts_integer_coordinates(client, path):
    response = client.get(path)

    assert response.status_code == 404


def test_removed_municipal_fhi_route_is_gone(client):
    assert client.get("/api/flood-risk-municipio?muni=centla").status_code == 404


def test_config_no_longer_exposes_fhi_settings():
    for name in ("MUNICIPAL_TIFS", "DATA_DIR", "FLOOD_MAPS_DIR"):
        assert not hasattr(config, name)


def test_openapi_no_longer_documents_the_fhi_route():
    # test_api_docs pins documented paths == served routes; this only guards
    # the retired contract and its schema.
    import yaml

    spec = yaml.safe_load(Path("backend/openapi.yaml").read_text(encoding="utf-8"))
    assert "/api/flood-risk-municipio" not in spec["paths"]
    assert "MuniQuerySchema" not in spec["components"]["schemas"]


@pytest.mark.parametrize("content", [None, "{not json"])
def test_metadata_reports_an_unavailable_map_instead_of_crashing(client, tmp_path, monkeypatch, content):
    from backend.routes import flood_routes

    if content is not None:
        (tmp_path / "metadata.json").write_text(content)
    monkeypatch.setattr(flood_routes, "FLOOD_RISK_DIR", tmp_path)

    response = client.get("/api/flood-risk/metadata")

    assert response.status_code == 503
    assert "mapa de susceptibilidad" in response.get_json()["error"]

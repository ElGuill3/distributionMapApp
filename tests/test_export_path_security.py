"""Public export-route regression tests using synthetic, isolated files."""

import hashlib
import zipfile
from io import BytesIO

import pytest
from flask import Flask

import backend.services.export_service as service
import routes.export_routes as route


@pytest.fixture
def export_files(tmp_path, monkeypatch):
    static = tmp_path / "static"
    gifs = static / "gifs"
    gifs.mkdir(parents=True)
    gif = gifs / "ndvi_test.gif"
    gif.write_bytes(b"GIF89a-synthetic")
    private = tmp_path / "private.txt"
    private.write_bytes(b"synthetic-private-content")
    other = static / "notes.txt"
    other.write_bytes(b"synthetic-not-a-gif")
    monkeypatch.setattr(route, "STATIC_DIR", static)
    monkeypatch.setattr(service, "STATIC_DIR", static)
    app = Flask(__name__)
    app.config["TESTING"] = True
    app.register_blueprint(route.export_bp)
    return app.test_client(), static, gif, private, other


def payload(paths):
    return {
        "gifPaths": paths,
        "seriesData": {"dates": ["2020-03-01"], "variables": {"ndvi": [0.5]}},
        "bbox": [-92.5, 17.0, -91.0, 18.0],
        "metadata": {"variableKeys": ["ndvi"]},
    }


def snapshot(root):
    return {
        str(path.relative_to(root)): hashlib.sha256(path.read_bytes()).hexdigest()
        for path in root.rglob("*")
        if path.is_file()
    }


@pytest.mark.parametrize(
    "path_kind",
    ["traversal", "absolute", "wrong-directory", "wrong-extension", "backslash"],
)
def test_untrusted_paths_are_rejected_without_file_changes(export_files, path_kind):
    client, static, gif, private, _ = export_files
    values = {
        "traversal": "../private.txt",
        "absolute": str(private),
        "wrong-directory": "notes.txt",
        "wrong-extension": "gifs/private.txt",
        "backslash": "gifs\\..\\private.txt",
    }
    (static / "gifs" / "private.txt").write_bytes(b"synthetic-text")
    before = snapshot(static.parent)
    response = client.post("/api/export/bundle", json=payload([values[path_kind]]))
    assert response.status_code == 400
    assert response.get_json() == {"error": "Invalid request body"}
    assert response.content_type == "application/json"
    assert b"synthetic-private-content" not in response.data
    assert snapshot(static.parent) == before


def test_symlink_escape_is_rejected_without_file_changes(export_files):
    client, static, _, private, _ = export_files
    link = static / "gifs" / "ndvi_link.gif"
    link.symlink_to(private)
    before = snapshot(static.parent)
    response = client.post("/api/export/bundle", json=payload(["gifs/ndvi_link.gif"]))
    assert response.status_code == 400
    assert response.get_json() == {"error": "Invalid request body"}
    assert snapshot(static.parent) == before


@pytest.mark.parametrize("prefix", ["", "/static/"])
def test_valid_gif_export_preserves_zip_content_and_source_files(export_files, prefix):
    client, static, gif, _, _ = export_files
    before = snapshot(static.parent)
    response = client.post(
        "/api/export/bundle", json=payload([prefix + "gifs/ndvi_test.gif"])
    )
    assert response.status_code == 200
    assert response.content_type == "application/zip"
    with zipfile.ZipFile(BytesIO(response.data)) as archive:
        assert set(archive.namelist()) == {
            "timeseries.csv",
            "metadata.json",
            "ndvi_test.gif",
        }
        assert archive.read("ndvi_test.gif") == gif.read_bytes()
        assert b"2020-03-01,0.5" in archive.read("timeseries.csv")
    assert snapshot(static.parent) == before


@pytest.mark.parametrize("path_kind", ["traversal", "absolute", "symlink"])
def test_zip_service_also_rejects_escaping_paths(export_files, path_kind):
    _, static, _, private, _ = export_files
    (static / "gifs" / "ndvi_link.gif").symlink_to(private)
    paths = {
        "traversal": "../private.txt",
        "absolute": str(private),
        "symlink": "gifs/ndvi_link.gif",
    }
    before = snapshot(static.parent)
    with pytest.raises(ValueError, match="Invalid export GIF path"):
        service.create_export_zip("date,ndvi\n", [paths[path_kind]], {})
    assert snapshot(static.parent) == before


@pytest.mark.parametrize("case", ["directory", "missing-before-forbidden"])
def test_all_invalid_paths_are_checked_before_missing_files(export_files, case):
    client, static, *_ = export_files
    (static / "gifs" / "directory.gif").mkdir()
    paths = {
        "directory": ["gifs/directory.gif"],
        "missing-before-forbidden": ["gifs/missing.gif", "../private.gif"],
    }[case]
    before = snapshot(static.parent)
    response = client.post("/api/export/bundle", json=payload(paths))
    assert response.status_code == 400
    assert response.get_json() == {"error": "Invalid request body"}
    with pytest.raises(ValueError, match="Invalid export GIF path"):
        service.create_export_zip("date,ndvi\n", paths, {})
    assert snapshot(static.parent) == before


def test_absent_valid_gif_keeps_existing_not_found_contract(export_files):
    client, static, *_ = export_files
    before = snapshot(static.parent)
    response = client.post(
        "/api/export/bundle", json=payload(["gifs/ndvi_missing.gif"])
    )
    assert response.status_code == 404
    assert response.get_json() == {
        "error": "Animation file no longer available. Please regenerate the animation."
    }
    assert snapshot(static.parent) == before

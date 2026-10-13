"""INEGI LiDAR tile index and resumable, verified downloads."""

import io
import json
import zipfile

import pytest

from backend.floodmodel import lidar

ROW = {
    "key": "702825813413",
    "clave_carta": "E15A89A3",
    "edicion": 2012,
    "formatos": [
        {
            "extension": "GRID",
            "peso": 2.26,
            "url": {"valor": "/contenidos/x/Terreno_GRID/702825813413_gr.zip"},
        },
        {"extension": "XYZ", "peso": 9.0, "url": {"valor": "/contenidos/x/a_xyz.zip"}},
    ],
}


def _zip_bytes(name="E15A89A3.txt", payload=b"grid"):
    buf = io.BytesIO()
    with zipfile.ZipFile(buf, "w") as zf:
        zf.writestr(name, payload)
    return buf.getvalue()


def test_tiles_from_rows_keeps_one_grid_download_per_sheet():
    tiles = lidar.tiles_from_rows([ROW, dict(ROW)])

    assert tiles == [
        lidar.Tile(
            sheet="E15A89A3",
            upc="702825813413",
            url="https://www.inegi.org.mx/contenidos/x/Terreno_GRID/702825813413_gr.zip",
        )
    ]


def test_download_tiles_skips_valid_zips_and_replaces_corrupt_ones(tmp_path):
    good = lidar.Tile("A1", "1", "https://example/1_gr.zip")
    bad = lidar.Tile("B2", "2", "https://example/2_gr.zip")
    new = lidar.Tile("C3", "3", "https://example/3_gr.zip")
    (tmp_path / "A1.zip").write_bytes(_zip_bytes())
    (tmp_path / "B2.zip").write_bytes(b"truncated")
    fetched = []

    def fetch(url):
        fetched.append(url)
        return _zip_bytes()

    summary = lidar.download_tiles(
        [good, bad, new], tmp_path, fetch=fetch, workers=2, backoff_s=0
    )

    assert sorted(fetched) == ["https://example/2_gr.zip", "https://example/3_gr.zip"]
    assert summary == {"skipped": 1, "downloaded": 2, "failed": []}
    for sheet in ("A1", "B2", "C3"):
        assert zipfile.is_zipfile(tmp_path / f"{sheet}.zip")
    assert not list(tmp_path.glob("*.part"))


def test_download_tiles_reports_failures_without_leaving_partial_files(tmp_path):
    tile = lidar.Tile("D4", "4", "https://example/4_gr.zip")

    def fetch(_url):
        return b"not a zip"

    summary = lidar.download_tiles(
        [tile], tmp_path, fetch=fetch, workers=1, retries=2, backoff_s=0
    )

    assert summary == {"skipped": 0, "downloaded": 0, "failed": ["D4"]}
    assert list(tmp_path.iterdir()) == []


def test_write_index_round_trips(tmp_path):
    tiles = lidar.tiles_from_rows([ROW])
    path = tmp_path / "index.json"

    lidar.write_index(tiles, path)

    assert lidar.read_index(path) == tiles
    assert json.loads(path.read_text())[0]["sheet"] == "E15A89A3"


@pytest.mark.parametrize("pages", [[[ROW], []], [[ROW]]])
def test_fetch_catalog_rows_pages_until_empty_or_failure(pages):
    calls = []

    def post(body):
        calls.append(body["pag"])
        if body["pag"] > len(pages):
            return {"success": False}
        return {"success": True, "list": {"mapas": pages[body["pag"] - 1]}}

    rows = lidar.fetch_catalog_rows(post=post, page_size=50)

    assert rows == [ROW]
    assert calls[0] == 1

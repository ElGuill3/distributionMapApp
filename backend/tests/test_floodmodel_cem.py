"""INEGI Continuo de Elevaciones Mexicano (CEM 3.0): URL and verified download."""

import io
import zipfile

import pytest

pytest.importorskip("rasterio")

from backend.floodmodel import cem  # noqa: E402


def _zip_with(names):
    buffer = io.BytesIO()
    with zipfile.ZipFile(buffer, "w") as zf:
        for name in names:
            zf.writestr(name, b"data")
    return buffer.getvalue()


def test_state_url_matches_the_inegi_download_service():
    url = cem.state_url("Tabasco", "27", 15)

    assert url == (
        "https://www.inegi.org.mx/app/geo2/elevacionesmex/DownloadFile.do"
        "?file=CEM_V3_20170619_R15_E27_TIF.zip&res=15&entidad=Tabasco"
    )


def test_download_extracts_the_tif_and_skips_when_present(tmp_path):
    calls = []

    def fetch(url):
        calls.append(url)
        return _zip_with(["Tabasco_r15m.tif", "Tabasco_r15m.tfw", "Tabasco_r15m.tif.ovr"])

    tif = cem.download("Tabasco", "27", tmp_path, fetch=fetch)
    again = cem.download("Tabasco", "27", tmp_path, fetch=fetch)

    assert tif == again == tmp_path / "Tabasco_r15m.tif"
    assert tif.read_bytes() == b"data"
    assert len(calls) == 1


def test_download_rejects_a_non_zip_response_and_leaves_nothing(tmp_path):
    with pytest.raises(RuntimeError, match="not a ZIP"):
        cem.download("Tabasco", "27", tmp_path, fetch=lambda url: b"<html>error</html>")

    assert list(tmp_path.iterdir()) == []

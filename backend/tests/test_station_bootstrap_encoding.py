"""CONAGUA encodings must produce usable, normalized rainfall station files."""

import pytest

from scripts import bootstrap_stations

CSV = (
    "Comisión Nacional del Agua\nSubdirección General Técnica\n"
    "Estación: Boca del Cerro\nClave: BDCTB\nEstado: Tabasco\n"
    "Municipio: Tenosique\n\n"
    "Fecha, Precipitación(mm), Temperatura Ambiente(ºC)\n"
    "1948/08/01,0.00,-\n1948/08/02,12.50,24.0\n"
)


@pytest.mark.parametrize("encoding", ["utf8", "mojibake", "latin1"])
def test_rainfall_download_is_normalized_without_changing_observations(
    tmp_path, monkeypatch, capsys, encoding
):
    monkeypatch.setattr(bootstrap_stations, "BASE_DIR", tmp_path)
    monkeypatch.setattr(bootstrap_stations, "CONAGUA_HIDROS_STATIONS", [])
    monkeypatch.setattr(bootstrap_stations, "CONAGUA_CLIMAS_STATIONS", ["BDCTB"])
    if encoding == "mojibake":
        body = CSV.encode("utf-8").decode("latin-1").encode("utf-8")
    else:
        body = CSV.encode("latin-1" if encoding == "latin1" else "utf-8")

    def download(scraper):
        scraper.output_dir.mkdir(parents=True)
        (scraper.output_dir / "BDCTB.csv").write_bytes(body)

    monkeypatch.setattr(bootstrap_stations.ConaguaScraper, "scrape", download)
    assert bootstrap_stations.main([]) == 0
    saved = tmp_path / "backend/data/stations/climas/BDCTB.csv"
    assert saved.read_bytes() == CSV.encode("utf-8")
    captured = capsys.readouterr()
    assert captured.out == "Stations: 1 refreshed; 1 usable.\n"
    assert captured.err == ""
    assert not list(saved.parent.parent.glob(".bootstrap-*"))

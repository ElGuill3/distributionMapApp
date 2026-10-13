"""Startup station downloads use isolated transport and filesystem fixtures."""

import pytest

from backend.scripts import bootstrap_stations

VALID_CSV = (
    "Clave: BDCTB\nEstacion: Boca del Cerro\nMunicipio: Tenosique\n"
    "Estado: Tabasco\nOrganismo: CONAGUA\nTipo: Hidro\n"
    "Fecha,Nivel(m)\n2026-10-01,12.5\n"
)


@pytest.fixture
def station_root(tmp_path, monkeypatch):
    monkeypatch.setattr(bootstrap_stations, "BASE_DIR", tmp_path)
    monkeypatch.setattr(bootstrap_stations, "CONAGUA_HIDROS_STATIONS", ["BDCTB"])
    monkeypatch.setattr(bootstrap_stations, "CONAGUA_CLIMAS_STATIONS", [])
    monkeypatch.setattr(bootstrap_stations.ConaguaScraper, "scrape", lambda _self: None)
    return tmp_path / "backend/data/stations"


def test_successful_download_is_available_before_bootstrap_returns(
    station_root, monkeypatch, capsys
):
    def download(scraper):
        scraper.output_dir.mkdir(parents=True)
        (scraper.output_dir / "BDCTB.csv").write_text(VALID_CSV, encoding="utf-8")

    monkeypatch.setattr(bootstrap_stations.ConaguaScraper, "scrape", download)
    assert bootstrap_stations.main([]) == 0
    assert (station_root / "hidros/BDCTB.csv").read_text() == VALID_CSV
    captured = capsys.readouterr()
    assert captured.out == "Stations: 1 refreshed; 1 usable.\n"
    assert captured.err == ""
    assert sorted(p.name for p in station_root.iterdir()) == ["hidros"]


def test_failed_download_uses_local_data_with_warning(station_root, capsys):
    cached = station_root / "hidros/BDCTB.csv"
    cached.parent.mkdir(parents=True)
    cached.write_text(VALID_CSV)
    before = cached.stat().st_mtime_ns

    assert bootstrap_stations.main([]) == 0
    assert cached.read_text() == VALID_CSV
    assert cached.stat().st_mtime_ns == before
    captured = capsys.readouterr()
    assert captured.out == "Stations: 0 refreshed; 1 usable.\n"
    assert captured.err == (
        "Warning: station downloads unavailable or invalid for hidros/BDCTB; "
        "using available local station data.\n"
    )


def test_failed_download_without_local_data_stops(station_root, capsys):
    assert bootstrap_stations.main([]) == 2
    captured = capsys.readouterr()
    assert captured.out == ""
    assert captured.err == (
        "Station bootstrap failed: no usable station data is available. "
        "Check CONAGUA connectivity and station configuration, then retry.\n"
    )
    assert not list(station_root.rglob("*.csv"))
    assert not list(station_root.glob(".bootstrap-*"))


@pytest.mark.parametrize(
    "body",
    [
        "<html>Blocked</html>",
        VALID_CSV.replace("2026-10-01,12.5", "not-a-date,missing"),
        VALID_CSV.replace("BDCTB", "OTHER"),
        VALID_CSV.replace("Nivel(m)", "Unexpected"),
    ],
)
def test_invalid_download_never_replaces_local_data(
    station_root, monkeypatch, capsys, body
):
    cached = station_root / "hidros/BDCTB.csv"
    cached.parent.mkdir(parents=True)
    cached.write_text(VALID_CSV)
    before = cached.stat().st_mtime_ns

    def download(scraper):
        scraper.output_dir.mkdir(parents=True)
        (scraper.output_dir / "BDCTB.csv").write_text(body)

    monkeypatch.setattr(bootstrap_stations.ConaguaScraper, "scrape", download)
    assert bootstrap_stations.main([]) == 0
    assert cached.read_text() == VALID_CSV
    assert cached.stat().st_mtime_ns == before
    captured = capsys.readouterr()
    assert captured.out == "Stations: 0 refreshed; 1 usable.\n"
    assert "Warning:" in captured.err
    assert not list(station_root.glob(".bootstrap-*"))


def test_invalid_local_data_does_not_allow_startup(station_root, capsys):
    cached = station_root / "hidros/BDCTB.csv"
    cached.parent.mkdir(parents=True)
    cached.write_text("not a station CSV")
    assert bootstrap_stations.main([]) == 2
    assert "no usable station data" in capsys.readouterr().err
    assert cached.read_text() == "not a station CSV"


def test_partial_failure_keeps_available_stations(station_root, monkeypatch, capsys):
    monkeypatch.setattr(
        bootstrap_stations, "CONAGUA_HIDROS_STATIONS", ["BDCTB", "SPTTB"]
    )

    def download(scraper):
        scraper.output_dir.mkdir(parents=True)
        (scraper.output_dir / "BDCTB.csv").write_text(VALID_CSV)

    monkeypatch.setattr(bootstrap_stations.ConaguaScraper, "scrape", download)
    assert bootstrap_stations.main([]) == 0
    captured = capsys.readouterr()
    assert captured.out == "Stations: 1 refreshed; 1 usable.\n"
    assert "hidros/SPTTB" in captured.err
    assert (station_root / "hidros/BDCTB.csv").exists()
    assert not (station_root / "hidros/SPTTB.csv").exists()


@pytest.mark.parametrize("downloaded", [False, True])
def test_diagnostics_distinguish_missing_download_from_invalid_csv(
    station_root, monkeypatch, caplog, downloaded
):
    caplog.set_level("INFO")

    def download(scraper):
        if downloaded:
            scraper.output_dir.mkdir(parents=True)
            (scraper.output_dir / "BDCTB.csv").write_text("invalid CSV")

    monkeypatch.setattr(bootstrap_stations.ConaguaScraper, "scrape", download)
    assert bootstrap_stations.main([]) == 2
    assert "Stations: refreshing hidros/BDCTB" in caplog.text
    reason = "invalid station metadata" if downloaded else "no file downloaded"
    assert f"Stations: hidros/BDCTB unavailable: {reason}" in caplog.text
    assert not list(station_root.rglob("*.csv"))


def test_unexpected_download_error_is_reported_without_losing_cache(
    station_root, monkeypatch, caplog
):
    cached = station_root / "hidros/BDCTB.csv"
    cached.parent.mkdir(parents=True)
    cached.write_text(VALID_CSV)
    before = cached.stat().st_mtime_ns
    caplog.set_level("INFO")

    def failed_download(_scraper):
        raise RuntimeError("private transport detail")

    monkeypatch.setattr(bootstrap_stations.ConaguaScraper, "scrape", failed_download)
    assert bootstrap_stations.main([]) == 0
    assert "Stations: hidros downloader failed (RuntimeError)" in caplog.text
    assert "private transport detail" not in caplog.text
    assert cached.read_text() == VALID_CSV
    assert cached.stat().st_mtime_ns == before


def test_unrecognized_rainfall_header_reports_encoding_hint(
    station_root, monkeypatch, caplog
):
    monkeypatch.setattr(bootstrap_stations, "CONAGUA_HIDROS_STATIONS", [])
    monkeypatch.setattr(bootstrap_stations, "CONAGUA_CLIMAS_STATIONS", ["BDCTB"])
    caplog.set_level("INFO")

    def download(scraper):
        scraper.output_dir.mkdir(parents=True)
        (scraper.output_dir / "BDCTB.csv").write_text(
            VALID_CSV.replace("Nivel(m)", "Rainfall")
        )

    monkeypatch.setattr(bootstrap_stations.ConaguaScraper, "scrape", download)
    assert bootstrap_stations.main([]) == 2
    assert (
        "Stations: climas/BDCTB unavailable: missing recognized precipitacion "
        "column; check CSV encoding" in caplog.text
    )
    assert not list(station_root.rglob("*.csv"))

"""Verifier-found compatibility and complete-response regression cases."""

import pytest

from backend.tests.test_station_bootstrap import VALID_CSV
from scripts import bootstrap_stations


@pytest.fixture
def station_root(tmp_path, monkeypatch):
    monkeypatch.setattr(bootstrap_stations, "BASE_DIR", tmp_path)
    monkeypatch.setattr(bootstrap_stations, "CONAGUA_HIDROS_STATIONS", ["BDCTB"])
    monkeypatch.setattr(bootstrap_stations, "CONAGUA_CLIMAS_STATIONS", [])
    monkeypatch.setattr(bootstrap_stations.ConaguaScraper, "scrape", lambda _self: None)
    return tmp_path / "backend/data/stations"


@pytest.mark.parametrize(
    "body",
    [
        VALID_CSV.replace("Fecha,Nivel", " Fecha ,Nivel"),
        VALID_CSV.replace("2026-10-01", "31/10/2026"),
    ],
)
def test_service_readable_cached_csv_allows_offline_startup(station_root, capsys, body):
    cached = station_root / "hidros/BDCTB.csv"
    cached.parent.mkdir(parents=True)
    cached.write_text(body)
    before = cached.stat().st_mtime_ns
    assert bootstrap_stations.main([]) == 0
    assert cached.read_text() == body
    assert cached.stat().st_mtime_ns == before
    captured = capsys.readouterr()
    assert captured.out == "Stations: 0 refreshed; 1 usable.\n"
    assert captured.err == (
        "Warning: station downloads unavailable or invalid for hidros/BDCTB; "
        "using available local station data.\n"
    )


@pytest.mark.parametrize("has_cache", [True, False])
def test_malformed_later_row_is_not_promoted(
    station_root, monkeypatch, capsys, has_cache
):
    cached = station_root / "hidros/BDCTB.csv"
    if has_cache:
        cached.parent.mkdir(parents=True)
        cached.write_text(VALID_CSV)
        before = cached.stat().st_mtime_ns

    def download(scraper):
        scraper.output_dir.mkdir(parents=True)
        (scraper.output_dir / "BDCTB.csv").write_text(
            VALID_CSV + "2026-10-02,13,unexpected\n"
        )

    monkeypatch.setattr(bootstrap_stations.ConaguaScraper, "scrape", download)
    assert bootstrap_stations.main([]) == (0 if has_cache else 2)
    captured = capsys.readouterr()
    if has_cache:
        assert cached.read_text() == VALID_CSV
        assert cached.stat().st_mtime_ns == before
        assert captured.out == "Stations: 0 refreshed; 1 usable.\n"
        assert captured.err == (
            "Warning: station downloads unavailable or invalid for hidros/BDCTB; "
            "using available local station data.\n"
        )
    else:
        assert not cached.exists()
        assert captured.out == ""
        assert captured.err == (
            "Station bootstrap failed: no usable station data is available. "
            "Check CONAGUA connectivity and station configuration, then retry.\n"
        )
    assert not list(station_root.glob(".bootstrap-*"))

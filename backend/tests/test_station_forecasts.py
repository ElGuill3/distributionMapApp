"""Published station routes, real offline publications and isolated disk copies."""

import copy
import json
from pathlib import Path
from unittest.mock import Mock

import pytest
import requests

from backend.forecast_feed import ForecastFeed, UNAVAILABLE
from backend.tests.test_forecast_feed import Reply

CODES = ("BDCTB", "MACTB", "SAACP", "PNVTB", "TAPTB")


def publication(code):
    return json.loads(
        (Path(__file__).parent / "fixtures" / "station_forecasts" / f"{code.lower()}.json").read_text()
    )


@pytest.mark.parametrize("code", CODES)
def test_published_route_and_cache_are_station_specific(tmp_path, monkeypatch, code):
    import backend.app as module

    http = Mock()
    http.get.return_value = Reply(publication(code))
    service = ForecastFeed(
        f"https://example.test/{code.lower()}/latest.json",
        tmp_path / code.lower() / "latest.json",
        http=http,
        station_code=code,
    )
    if code == "BDCTB":
        monkeypatch.setattr(module, "forecast_feed", service)
    else:
        monkeypatch.setitem(module.forecast_feeds, code, service)
    http.get.assert_not_called()
    client = module.app.test_client()
    response = client.get(f"/api/v1/forecasts/{code.lower()}")
    assert response.status_code == 200
    assert response.json["forecast"] == publication(code)
    assert response.json["source"] == "network"
    assert response.json["updating"] is False
    assert response.headers["Cache-Control"] == "no-store"
    assert http.get.call_args.args[0] == service.url
    before = service.cache_path.read_bytes()
    # A valid publication from a different station must not poison this cache.
    http.get.return_value = Reply(publication("MACTB" if code == "BDCTB" else "BDCTB"))
    cached = client.get(f"/api/v1/forecasts/{code.lower()}")
    assert cached.status_code == 200
    assert cached.json == {**response.json, "source": "cache"}
    assert service.cache_path.read_bytes() == before
    http.get.side_effect = requests.Timeout("private detail")
    assert client.get(f"/api/v1/forecasts/{code.lower()}").json == cached.json


@pytest.mark.parametrize("code", ["unknown", "spttb", "MACTB", "constructor", "__proto__"])
def test_unknown_code_is_404_without_upstream_or_courier(monkeypatch, code):
    import backend.app as module

    get = Mock(side_effect=AssertionError("network forbidden"))
    put = Mock(side_effect=AssertionError("courier forbidden"))
    monkeypatch.setattr("requests.get", get)
    monkeypatch.setattr("requests.put", put)
    response = module.app.test_client().get(f"/api/v1/forecasts/{code}")
    assert response.status_code == 404
    assert response.json == {"error": "No hay un pronóstico publicado para esta estación."}
    assert response.headers["Cache-Control"] == "no-store"
    get.assert_not_called()
    put.assert_not_called()


@pytest.mark.parametrize("change", ["distance", "namo", "name"])
def test_invalid_station_publication_preserves_last_valid_copy(tmp_path, change):
    http = Mock()
    http.get.return_value = Reply(publication("MACTB"))
    service = ForecastFeed("https://example.test/mactb/latest.json", tmp_path / "latest.json", http=http, station_code="MACTB")
    good = service.get()
    before = service.cache_path.read_bytes()
    invalid = copy.deepcopy(publication("MACTB"))
    if change == "distance":
        invalid["forecasts"]["h1"]["distance_to_namo_m"] = 0
    elif change == "namo":
        invalid["forecasts"]["h1"]["namo_m"] = float("nan")
    else:
        invalid["station"]["name"] = "Boca del Cerro"
    http.get.return_value = Reply(invalid)
    assert service.get() == {**good, "source": "cache"}
    assert service.cache_path.read_bytes() == before


def test_no_mactb_copy_returns_same_safe_503(tmp_path, monkeypatch):
    import backend.app as module

    http = Mock()
    http.get.side_effect = requests.ConnectionError("private detail")
    service = ForecastFeed("https://example.test/mactb/latest.json", tmp_path / "latest.json", http=http, station_code="MACTB")
    monkeypatch.setitem(module.forecast_feeds, "MACTB", service)
    response = module.app.test_client().get("/api/v1/forecasts/mactb")
    assert response.status_code == 503
    assert response.json == {"error": UNAVAILABLE}
    assert response.headers["Cache-Control"] == "no-store"
    assert not service.cache_path.exists()


def test_catalogue_adds_forecast_only_stations_without_changing_csv_entries(tmp_path, monkeypatch):
    from backend import config
    import backend.app as module

    import backend.routes.station_routes as routes

    # Exercise real discovery with deterministic CSV metadata, never local data.
    for code in ("BDCTB", "SPTTB"):
        for category in ("hidros", "climas"):
            path = tmp_path / "backend" / "data" / "stations" / category / f"{code}.csv"
            path.parent.mkdir(parents=True, exist_ok=True)
            path.write_text(f"Clave: {code}\nEstacion: {code}\nMunicipio: Municipio\nEstado: Tabasco\nOrganismo: CONAGUA\nTipo: Nivel\nFecha,Nivel(m)\n2026-10-01,1\n")
    monkeypatch.setattr(config, "BASE_DIR", tmp_path)
    discovered = config._load_local_stations()
    assert set(config.FORECAST_STATIONS).issubset(config.LOCAL_STATIONS)
    monkeypatch.setattr(routes, "LOCAL_STATIONS", {**discovered, **config.FORECAST_STATIONS})
    response = module.app.test_client().get('/api/local-stations')
    assert response.status_code == 200
    for code in ('BDCTB', 'SPTTB'):
        for suffix in ('hidro', 'clima'):
            key = f'{code}_{suffix}'
            info = discovered[key]
            assert response.json[key] == {k: info.get(k) for k in ('name', 'type', 'coords', 'station_name', 'municipio')}
    for code, name, coords in (
        ('MACTB', 'Macuspana', [17.766667, -92.6]),
        ('SAACP', 'Salto de Agua', [17.566667, -92.35]),
        ('PNVTB', 'Pueblo Nuevo', [17.854167, -92.879167]),
        ('TAPTB', 'Tapijulapa', [17.456944, -92.778611]),
    ):
        assert response.json[f'{code}_hidro'] == {'name': name, 'station_name': name, 'type': 'hidrometrica', 'coords': coords, 'municipio': None}
        assert f'{code}_hidro' not in discovered


def test_only_the_bdctb_feed_carries_the_messenger_token():
    """One IPCET table serves every station, so only BDCTB uploads it (review R3)."""
    from backend import app as module

    assert module.forecast_feeds
    # Compare a boolean so a failure never prints the token itself.
    holders = sorted(code for code, feed in module.forecast_feeds.items() if bool(feed.token))
    assert holders == []

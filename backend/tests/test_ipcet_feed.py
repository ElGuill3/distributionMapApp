"""Official IPCET publications through public HTTP, with fixture-only transport."""

import copy
import json
import threading
import time
from unittest.mock import Mock

import pytest
import requests

from backend.tests.test_forecast_feed import Reply


def levels():
    return {
        "schema": "ipcet-levels/v1",
        "table_date": "2026-10-19",
        "issued_at": "2026-10-19T06:00:00-06:00",
        "last_modified": "Mon, 19 Oct 2026 16:00:00 GMT",
        "source_url": "https://tabasco.gob.mx/ipcet",
        "stations": [
            {
                "code": code,
                "river": "San Pedro",
                "station": "San Pedro",
                "namo": 19.21,
                "namino": None,
                "ayer": 16.5,
                "hoy": 16.49,
                "diff": -0.01,
                "capacity": None,
                "semaforo": "NORMAL",
                "problems": [],
            }
            for code in ("SPTTB", None)
        ],
    }


def recent():
    return {
        "schema": "ipcet-recent/v1",
        "stations": {
            code: [{"date": "2026-10-19", "hoy": 16.49, "semaforo": None}]
            for code in ("SPTTB", "ABCDE")
        },
    }


@pytest.fixture(params=["levels", "recent"])
def proxy(request, tmp_path, monkeypatch):
    import backend.app as module
    from backend.ipcet_feed import IpcetFeed

    kind = request.param
    http = Mock()
    publication = levels() if kind == "levels" else recent()
    http.get.return_value = Reply(publication)
    service = IpcetFeed(
        "https://example.test/" + kind,
        tmp_path / (kind + ".json"),
        kind=kind,
        http=http,
        fetch_deadline=0.1,
    )
    monkeypatch.setattr(module, "ipcet_" + kind + "_feed", service)
    path = "/api/v1/ipcet/levels"
    expected = copy.deepcopy(publication)
    if kind == "recent":
        path += "/SPTTB/recent"
        expected["stations"].pop("ABCDE")
    with module.app.test_client() as client:
        yield client, path, service, http, publication, expected


def test_network_then_disk_fallback(proxy):
    client, path, service, http, _, expected = proxy
    response = client.get(path)
    assert response.status_code == 200
    assert response.get_json() == {**expected, "source": "network"}
    assert response.headers["Cache-Control"] == "no-store"
    http.get.assert_called_once_with(
        service.url,
        headers={"Accept": "application/json"},
        timeout=(2, 5),
        allow_redirects=False,
        stream=True,
    )
    http.get.side_effect = requests.Timeout("private upstream detail")
    response = client.get(path)
    assert response.status_code == 200
    assert response.get_json() == {**expected, "source": "cache"}


def test_network_down_without_cache(proxy):
    client, path, service, http, _, _ = proxy
    http.get.side_effect = requests.ConnectionError("private upstream detail")
    response = client.get(path)
    assert response.status_code == 503
    assert response.get_json() == {"error": "No hay una publicación IPCET válida guardada."}
    assert not service.cache_path.exists()


def test_blocked_network_returns_cache_under_one_second(proxy):
    client, path, _, http, _, expected = proxy
    assert client.get(path).status_code == 200
    release = threading.Event()
    workers = []

    def blocked(*_, **__):
        workers.append(threading.current_thread())
        release.wait(2)
        raise requests.Timeout()

    http.get.side_effect = blocked
    try:
        start = time.monotonic()
        response = client.get(path)
        assert time.monotonic() - start < 1
        assert response.status_code == 200
        assert response.get_json() == {**expected, "source": "cache"}
    finally:
        release.set()
        for worker in workers:
            worker.join(2)


@pytest.mark.parametrize("bad", ["schema", "type", "nan", "infinity", "bool", "extra", "state"])
def test_invalid_payload_preserves_good_cache(proxy, bad):
    client, path, service, http, publication, expected = proxy
    assert client.get(path).status_code == 200
    before = service.cache_path.read_bytes()
    invalid = copy.deepcopy(publication)
    row = invalid["stations"][0] if service.kind == "levels" else invalid["stations"]["SPTTB"][0]
    if bad == "schema":
        invalid["schema"] = "wrong/v1"
    elif bad == "extra":
        row["unexpected"] = 1
    elif bad == "state":
        row["semaforo"] = []
    else:
        row["hoy"] = {"type": "16", "nan": float("nan"), "infinity": float("inf"), "bool": True}[bad]
    http.get.return_value = Reply(invalid)
    response = client.get(path)
    assert response.status_code == 200
    assert response.get_json() == {**expected, "source": "cache"}
    assert service.cache_path.read_bytes() == before


def test_unknown_and_malformed_codes(proxy):
    client, _, service, http, _, _ = proxy
    if service.kind != "recent":
        return
    for code in ("spttb", "ABC1E", "ABCDEF", "ABCD", "ABCDE%0A"):
        response = client.get(f"/api/v1/ipcet/levels/{code}/recent")
        assert response.status_code == 404
        assert response.get_json() == {"error": "Estación IPCET desconocida."}
    http.get.assert_not_called()
    response = client.get("/api/v1/ipcet/levels/ZZZZZ/recent")
    assert response.status_code == 404
    assert response.get_json() == {"error": "Estación IPCET desconocida."}
    assert json.loads(service.cache_path.read_text()) == recent()

"""Published v2 feed and L47 messenger, entirely fake HTTP."""

import base64
import copy
import hashlib
import json
import threading
import time
from datetime import datetime
from threading import Event
from unittest.mock import Mock, patch

import pytest
import requests

from backend.forecast_feed import ForecastFeed

DISCLAIMER = (
    "Pronóstico modelado, no es una observación ni un aviso oficial. "
    "Consulte el semáforo oficial de IPCET."
)


def payload():
    return {
        "schema": "bdctb-forecast/v2",
        "station": {"code": "BDCTB", "name": "Boca del Cerro"},
        "issue_time": "2026-10-19T11:00:00-06:00",
        "generated_at": "2026-10-19T17:00:00Z",
        "model_version": "bdctb-L1-postaudit-v1",
        "mode": "glofas_only",
        "live_input": None,
        "forecasts": {
            f"h{h}": {
                "target_date": f"2026-10-{19 + h:02}",
                "q10": 17.9,
                "q50": 18.4,
                "q90": 18.9,
                "namo_m": 19.21,
                "distance_to_namo_m": 18.4 - 19.21,
                "data_kind": "modeled_not_observed",
            }
            for h in (1, 3, 7)
        },
        "disclaimer": DISCLAIMER,
    }


class Reply:
    def __init__(self, value=None, status=200, body=None, headers=None):
        self.status_code = status
        self.body = json.dumps(value).encode() if body is None else body
        self.headers = headers or {}

    def __enter__(self):
        return self

    def __exit__(self, *_):
        pass

    def iter_content(self, chunk_size):
        yield self.body


def feed(tmp_path, http=None, token=""):
    return ForecastFeed(
        "https://example.test/latest.json",
        tmp_path / "latest.json",
        token=token,
        http=http or Mock(),
        now=lambda: datetime.fromisoformat("2026-10-19T18:00:00+00:00"),
        sleep=lambda _: None,
    )


def test_deadline_serves_cache_and_late_fetch_refreshes_it(tmp_path):
    http, release, workers = Mock(), Event(), []
    service = feed(tmp_path, http)
    http.get.return_value = Reply(payload())
    cached = service.get()
    fresh = {**payload(), "model_version": "fresh"}

    def blocked(*_, **__):
        workers.append(threading.current_thread())
        release.wait()
        return Reply(fresh)

    http.get.side_effect = blocked
    try:
        service = ForecastFeed(
            service.url, service.cache_path, http=http, fetch_deadline=0.2
        )
        start = time.monotonic()
        assert service.get() == {**cached, "source": "cache"}
        assert time.monotonic() - start < 1
    finally:
        release.set()
        for worker in workers:
            worker.join(2)
    assert json.loads(service.cache_path.read_text())["forecast"] == fresh


def test_network_then_disk_cache_on_failure_and_restart(tmp_path):
    http = Mock()
    http.get.return_value = Reply(payload())
    service = feed(tmp_path, http)
    result = service.get()
    assert result == {
        "forecast": payload(),
        "source": "network",
        "fetched_at": "2026-10-19T18:00:00+00:00",
        "updating": False,
    }
    http.get.assert_called_once_with(
        "https://example.test/latest.json",
        headers={"Accept": "application/json"},
        timeout=(2, 5),
        allow_redirects=False,
        stream=True,
    )
    http.get.side_effect = requests.Timeout("secret detail")
    assert feed(tmp_path, http).get() == {**result, "source": "cache"}


@pytest.mark.parametrize(
    "mutation",
    [
        lambda p: p.update(schema="bdctb-forecast/v1"),
        lambda p: p["forecasts"]["h1"].update(q10=20),
        lambda p: p["forecasts"]["h3"].update(q50=float("nan")),
        lambda p: p["forecasts"]["h7"].update(target_date="2026-10-25"),
        lambda p: p["forecasts"]["h1"].update(distance_to_namo_m=1),
        lambda p: p.update(mode="live"),
        lambda p: p.update(disclaimer="wrong"),
        lambda p: p.update(issue_time="2026-02-30T11:00:00-06:00"),
    ],
)
def test_invalid_never_replaces_valid_cache(tmp_path, mutation):
    http = Mock()
    http.get.return_value = Reply(payload())
    service = feed(tmp_path, http)
    service.get()
    before = (tmp_path / "latest.json").read_bytes()
    invalid = copy.deepcopy(payload())
    mutation(invalid)
    http.get.return_value = Reply(invalid)
    assert service.get()["forecast"] == payload()
    assert service.get()["source"] == "cache"
    assert (tmp_path / "latest.json").read_bytes() == before


@pytest.mark.parametrize(
    "reply", [Reply({}, status=503), Reply(body=b"{"), Reply(body=b"x" * 65537)]
)
def test_no_valid_copy_is_unavailable(tmp_path, reply):
    http = Mock()
    http.get.return_value = reply
    assert feed(tmp_path, http).get() is None
    assert not (tmp_path / "latest.json").exists()


def test_messenger_nonblocking_single_inflight_meta_last_and_today_ack(tmp_path):
    http = Mock()
    entered, release = Event(), Event()
    page = (
        b'<article><img src="/sites/default/files/table.jpg">'
        b'<img src="/sites/default/files/map.png"></article>'
    )
    modified = "Mon, 19 Oct 2026 16:00:00 GMT"

    def get(url, **kwargs):
        if url.endswith("latest.json"):
            return Reply(payload())
        if "api.github.com" in url:
            entered.set()
            assert release.wait(3)
            return Reply(status=404)
        if "hidrometeorologico" in url:
            return Reply(status=404)
        if "/noticias/" in url:
            return Reply(body=page)
        return Reply(body=b"image", headers={"Last-Modified": modified})

    http.get.side_effect = get
    http.put.return_value = Reply(status=201)
    service = feed(tmp_path, http, token="fake-token")
    assert service.get()["updating"] is False
    assert entered.wait(1)
    for _ in range(3):
        assert service.get()["updating"] is False
    release.set()
    service.worker.join(3)
    assert not service.worker.is_alive()
    puts = http.put.call_args_list
    assert [c.args[0].split("/2026-10-19/")[-1] for c in puts] == [
        "page.html",
        "table.jpg",
        "map.png",
        "meta.json",
    ]
    meta = json.loads(base64.b64decode(puts[-1].kwargs["json"]["content"]))
    assert set(meta) == {"page_url", "fetched_at", "images"}
    assert "hidrometereologico" in meta["page_url"]
    assert meta["fetched_at"] == "2026-10-19T18:00:00+00:00"
    assert meta["images"] == [
        {
            "url": "https://tabasco.gob.mx/sites/default/files/" + name,
            "last_modified": modified,
            "sha256": hashlib.sha256(b"image").hexdigest(),
            "bytes": 5,
        }
        for name in ("table.jpg", "map.png")
    ]
    assert all(c.kwargs["json"]["branch"] == "forecasts" for c in puts)
    assert service.get()["updating"] is True
    assert http.put.call_count == 4
    live = payload()
    live.update(
        mode="live", live_input={"date": "2026-10-19", "stage_m": 18, "age_days": 0}
    )
    http.get.side_effect = None
    http.get.return_value = Reply(live)
    assert service.get()["updating"] is False
    assert http.put.call_count == 4


@pytest.mark.parametrize(
    "token,live,meta_status",
    [("", False, 404), ("fake", True, 404), ("fake", False, 200)],
)
def test_messenger_guards(tmp_path, token, live, meta_status):
    p = payload()
    if live:
        p.update(
            mode="live", live_input={"date": "2026-10-19", "stage_m": 18, "age_days": 0}
        )
    http = Mock()
    http.get.side_effect = lambda url, **_: (
        Reply(p) if url.endswith("latest.json") else Reply(status=meta_status)
    )
    service = feed(tmp_path, http, token)
    service.get()
    if service.worker:
        service.worker.join(3)
    http.put.assert_not_called()


def test_retry_partial_upload_reads_existing_image_sha_without_small_json_cap(tmp_path):
    http = Mock()
    page = b'<article><img src="/sites/default/files/table.jpg"></article>'
    modified = "Mon, 19 Oct 2026 16:00:00 GMT"

    def get(url, **kwargs):
        if url.endswith("latest.json"):
            return Reply(payload())
        if "api.github.com" in url:
            if "table.jpg?" in url:
                return Reply({"sha": "existing-sha", "content": "a" * 100000})
            return Reply(status=404)
        if "/noticias/" in url:
            return Reply(body=page)
        return Reply(body=b"image", headers={"Last-Modified": modified})

    http.get.side_effect = get
    http.put.return_value = Reply(status=201)
    service = feed(tmp_path, http, "fake")
    service.get()
    service.worker.join(3)
    assert http.put.call_count == 3
    assert http.put.call_args_list[1].kwargs["json"]["sha"] == "existing-sha"
    assert http.put.call_args_list[-1].args[0].endswith("meta.json")


@pytest.mark.parametrize(
    "failure",
    ["missing_page", "missing_modified", "remote_image", "upload", "bad_meta_lookup"],
)
def test_failed_delivery_never_writes_meta_or_marks_success(tmp_path, failure, caplog):
    http = Mock()
    page = b'<article><img src="/sites/default/files/table.jpg"></article>'
    if failure == "remote_image":
        page = b'<img src="/sites/default/files/logo.jpg"><article><img src="https://other.test/sites/default/files/x.jpg"></article>'

    def get(url, **kwargs):
        if url.endswith("latest.json"):
            return Reply(payload())
        if "api.github.com" in url:
            assert kwargs["headers"]["Authorization"] == "Bearer fake-token"
            return Reply(status=403 if failure == "bad_meta_lookup" else 404)
        assert "Authorization" not in kwargs["headers"]
        if "/noticias/" in url:
            return Reply(body=page, status=404 if failure == "missing_page" else 200)
        assert url == "https://tabasco.gob.mx/sites/default/files/table.jpg"
        headers = (
            {}
            if failure == "missing_modified"
            else {"Last-Modified": "Mon, 19 Oct 2026 16:00:00 GMT"}
        )
        return Reply(body=b"image", headers=headers)

    http.get.side_effect = get
    http.put.return_value = Reply(status=500)
    service = feed(tmp_path, http, "fake-token")
    http.get.assert_not_called()  # Construction/startup is inert.
    service.get()
    service.worker.join(3)
    assert not service.worker.is_alive()
    assert not any(c.args[0].endswith("meta.json") for c in http.put.call_args_list)
    assert "fake-token" not in caplog.text
    # A later request can retry a failed delivery (rather than claiming success).
    before = http.get.call_count
    service.get()
    service.worker.join(3)
    assert http.get.call_count > before + 1
    assert all("other.test" not in c.args[0] for c in http.get.call_args_list)


@pytest.mark.parametrize(
    "src",
    [
        "/sites/default/files/%2E%2E",
        "/sites/default/files/%2e",
        "/sites/default/files/a%0Ab.jpg",
        "/sites/default/files/a%00.jpg",
        "/sites/default/files/%2E%2Ehidden.jpg",
    ],
)
def test_unsafe_image_names_upload_nothing(tmp_path, src):
    http = Mock()
    page = f'<article><img src="{src}"></article>'.encode()

    def get(url, **kwargs):
        if url.endswith("latest.json"):
            return Reply(payload())
        if "api.github.com" in url:
            return Reply(status=404)
        if "/noticias/" in url:
            return Reply(body=page)
        return Reply(
            body=b"image", headers={"Last-Modified": "Mon, 19 Oct 2026 16:00:00 GMT"}
        )

    http.get.side_effect = get
    service = feed(tmp_path, http, "fake-token")
    service.get()
    service.worker.join(3)
    assert not service.worker.is_alive()
    http.put.assert_not_called()


def test_paces_ipcet_and_uses_mexico_city_page_date(tmp_path):
    http = Mock()
    http.get.side_effect = lambda url, **_: (
        Reply(payload()) if url.endswith("latest.json") else Reply(status=404)
    )
    service = feed(tmp_path, http, "fake")
    service.now = lambda: datetime.fromisoformat("2026-10-20T02:00:00+00:00")
    service.sleep = Mock()
    with patch("backend.forecast_feed.time.monotonic", return_value=100):
        service.get()
        service.worker.join(3)
    page_calls = [c for c in http.get.call_args_list if "tabasco.gob.mx" in c.args[0]]
    assert len(page_calls) == 2
    assert all(c.args[0].endswith("19102026") for c in page_calls)
    service.sleep.assert_called_once_with(1)
    http.put.assert_not_called()


@pytest.mark.parametrize("outcome", ["existing_meta", "missing_page", "missing_table"])
def test_noop_courier_never_reports_updating(tmp_path, outcome):
    http = Mock()
    entered, release = Event(), Event()

    def get(url, **_):
        if url.endswith("latest.json"):
            return Reply(payload())
        entered.set()
        assert release.wait(3)
        if "api.github.com" in url:
            return Reply(status=200 if outcome == "existing_meta" else 404)
        return Reply(
            body=b"<article></article>",
            status=404 if outcome == "missing_page" else 200,
        )

    http.get.side_effect = get
    service = feed(tmp_path, http, "fake")
    try:
        assert service.get()["updating"] is False
        assert entered.wait(1)
        assert service.get()["updating"] is False
    finally:
        release.set()
        service.worker.join(3)
    assert not service.worker.is_alive()
    assert service.get()["updating"] is False
    service.worker.join(3)
    http.put.assert_not_called()


@pytest.mark.parametrize("upload_status", [201, 500])
def test_upload_in_progress_and_success_window(tmp_path, upload_status):
    http = Mock()
    entered, release = Event(), Event()

    def get(url, **_):
        if url.endswith("latest.json"):
            return Reply(payload())
        if "api.github.com" in url:
            return Reply(status=404)
        if "/noticias/" in url:
            return Reply(
                body=b'<article><img src="/sites/default/files/table.jpg"></article>'
            )
        return Reply(
            body=b"image", headers={"Last-Modified": "Mon, 19 Oct 2026 16:00:00 GMT"}
        )

    def put(*_, **kwargs):
        entered.set()
        assert release.wait(3)
        return Reply(status=upload_status)

    http.get.side_effect = get
    http.put.side_effect = put
    service = feed(tmp_path, http, "fake")
    try:
        service.get()
        assert entered.wait(1)
        assert service.get()["updating"] is True
    finally:
        release.set()
        service.worker.join(3)
    assert not service.worker.is_alive()
    # Hold a potential retry in its pre-check, so a failed upload stays false.
    check_entered, check_release = Event(), Event()

    def retry_get(url, **kwargs):
        if not url.endswith("latest.json"):
            check_entered.set()
            assert check_release.wait(3)
        return get(url, **kwargs)

    http.get.side_effect = retry_get
    try:
        assert service.get()["updating"] is (upload_status == 201)
        if upload_status == 500:
            assert check_entered.wait(1)
            assert service.get()["updating"] is False
        else:
            service.now = lambda: datetime.fromisoformat("2026-10-19T18:29:59+00:00")
            assert service.get()["updating"] is True
            service.now = lambda: datetime.fromisoformat("2026-10-19T18:30:00+00:00")
            assert service.get()["updating"] is False
            assert http.put.call_count == 3
    finally:
        check_release.set()
        service.worker.join(3)

"""Public NDVI seasonal shorthand and existing date-mode precedence (T3c)."""

from contextlib import ExitStack

import pytest

from tests.test_api_bbox_validation import TS_ROUTES, ts_patch
from tests.test_api_query_validation import (
    ROUTES,
    first_progress_event,
    gif_patches,
    query,
)

ALL_ROUTES = ROUTES + TS_ROUTES + [("ndvi", "/api/ndvi-timeseries-bbox")]
SEASONS = [
    ("2020", "primavera", "2020-03-01", "2020-05-31"),
    ("2020", "verano", "2020-06-01", "2020-08-31"),
    ("2020", "otono", "2020-09-01", "2020-11-30"),
    ("2020", "anual", "2020-01-01", "2020-12-31"),
    ("2020", "invierno", "2020-12-01", "2021-02-28"),
    ("2019", "invierno", "2019-12-01", "2020-02-29"),
]
NDVI_ROUTES = [route for route in ALL_ROUTES if route[0] == "ndvi"]


@pytest.fixture
def client(monkeypatch):
    from app import app
    from extensions import limiter

    monkeypatch.setitem(app.config, "TESTING", True)
    monkeypatch.setattr(limiter, "enabled", False)
    return app.test_client()


def builders(stack, variable, url):
    directory, gif, gif_series, annotate = gif_patches(stack, variable)
    ts_series = ts_patch(stack, variable)
    active = gif if "-gif-" in url else ts_series
    return directory, gif, gif_series, annotate, ts_series, active


def assert_success(response, mocks, url, start, end):
    directory, gif, gif_series, annotate, ts_series, active = mocks
    assert response.status_code == 200
    assert active.call_count == 1
    assert active.call_args.args[:3] == (start, end, [-92.0, 17.0, -91.0, 18.0])
    body = response.get_json()
    assert body["bbox"] == [-92.0, 17.0, -91.0, 18.0]
    assert body["dates"] == ["2020-07-01"]
    if "-gif-" in url:
        assert gif_series.call_count == annotate.call_count == 1
        assert gif_series.call_args.args[:2] == (start, end)
        assert body["gifUrl"].startswith("/static/gifs/")
        ts_series.assert_not_called()
    else:
        gif.assert_not_called()
        gif_series.assert_not_called()
        annotate.assert_not_called()
        directory.__truediv__.assert_not_called()


@pytest.mark.parametrize("variable,url", ALL_ROUTES)
@pytest.mark.parametrize("year,season,start,end", SEASONS)
def test_seasonal_dates_forward_exact_calendar_range(
    client, variable, url, year, season, start, end
):
    with ExitStack() as stack:
        mocks = builders(stack, variable, url)
        response = client.get(
            url, query_string={"year": year, "season": season, "bbox": query()["bbox"]}
        )
    assert_success(response, mocks, url, start, end)


@pytest.mark.parametrize("variable,url", ALL_ROUTES)
@pytest.mark.parametrize("season", ["verano", "unknown"])
def test_complete_explicit_dates_take_precedence(client, variable, url, season):
    with ExitStack() as stack:
        mocks = builders(stack, variable, url)
        response = client.get(
            url, query_string={**query(), "year": "bad", "season": season}
        )
    assert_success(response, mocks, url, "2020-01-01", "2020-12-31")


@pytest.mark.parametrize("variable,url", ALL_ROUTES)
@pytest.mark.parametrize("missing", ["start", "end"])
def test_incomplete_explicit_pair_uses_existing_seasonal_fallback(
    client, variable, url, missing
):
    params = {**query(), "year": "2020", "season": "verano"}
    del params[missing]
    with ExitStack() as stack:
        mocks = builders(stack, variable, url)
        response = client.get(url, query_string=params)
    assert_success(response, mocks, url, "2020-06-01", "2020-08-31")


@pytest.mark.parametrize("variable,url", NDVI_ROUTES)
@pytest.mark.parametrize(
    "params",
    [
        {"year": "bad", "season": "verano"},
        {"year": "2020", "season": "unknown"},
        {"year": "2020"},
        {"season": "verano"},
    ],
)
def test_unresolvable_shorthand_retains_missing_date_error_without_effects(
    client, variable, url, params
):
    task = "invalid-season-" + url.replace("/", "-")
    before = first_progress_event(client, task)
    missing = client.get(url, query_string={"bbox": query()["bbox"]})
    assert missing.status_code == 400
    with ExitStack() as stack:
        mocks = builders(stack, variable, url)
        response = client.get(
            url, query_string={**params, "bbox": query()["bbox"], "task_id": task}
        )
    assert response.status_code == 400
    assert response.get_json() == missing.get_json()
    assert response.get_json()["error"].startswith("fecha inválida: ")
    mocks[0].__truediv__.assert_not_called()
    for mock in mocks[1:5]:
        mock.assert_not_called()
    assert first_progress_event(client, task) == before

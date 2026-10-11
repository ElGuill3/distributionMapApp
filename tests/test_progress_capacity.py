"""Bounded progress through public GIF/SSE routes (T4c)."""

from contextlib import ExitStack
from unittest.mock import patch

import pytest

from tests.test_api_query_validation import gif_patches, query
from tests.test_progress_lifecycle import MISSING, TEMP_URL, generate, parse, sse_events


@pytest.fixture
def client(monkeypatch):
    from app import app
    from extensions import limiter

    monkeypatch.setitem(app.config, "TESTING", True)
    monkeypatch.setattr(limiter, "enabled", False)
    return app.test_client()


@pytest.mark.parametrize("limit", [1, 2])
def test_registry_keeps_newest_within_capacity(client, limit):
    from services import gif_service as service

    with patch.object(service, "SSE_MAX_PROGRESS_TASKS", limit, create=True):
        for index in range(limit + 1):
            generate(client, TEMP_URL, f"capacity-{limit}-{index}")
        assert sse_events(client, f"capacity-{limit}-0") == [MISSING]
        for index in range(1, limit + 1):
            assert (
                parse(sse_events(client, f"capacity-{limit}-{index}")[0])["progress"]
                == 0
            )


@pytest.mark.parametrize("limit", [2, 5])
def test_message_buffer_discards_oldest_but_retains_terminal_without_blocking(
    client, limit
):
    from services import gif_service as service

    def many_frames(**kwargs):
        for index in range(10):
            kwargs["progress_callback"](50, f"frame-{index}")
        kwargs["progress_callback"](100, "done")

    task = f"message-capacity-{limit}"
    with patch.object(service, "SSE_MAX_PROGRESS_MESSAGES", limit, create=True):
        counters = generate(client, TEMP_URL, task, annotate_side_effect=many_frames)
        assert counters == (1, 1, 1)
        events = [parse(event) for event in sse_events(client, task)]
    expected = [
        {"progress": 50, "message": f"frame-{index}"}
        for index in range(10 - (limit - 2), 10)
    ] + [{"progress": 100, "message": "done"}]
    assert events == expected
    assert sse_events(client, task) == [MISSING]


def test_capacity_prefers_completed_entry_over_running_producer(client):
    from services import gif_service as service

    with patch.object(service, "SSE_MAX_PROGRESS_TASKS", 2, create=True):
        with ExitStack() as stack:
            _, gif, _, _ = gif_patches(stack, "era5_temp")

            def while_running(*args, **kwargs):
                generate(
                    client, "/api/era5-soil-gif-bbox", "capacity-finished", "era5_soil"
                )
                generate(client, "/api/era5-soil-gif-bbox", "capacity-new", "era5_soil")
                assert sse_events(client, "capacity-finished") == [MISSING]
                stream = client.get(
                    "/api/gif-progress/capacity-running", buffered=False
                )
                try:
                    assert parse(next(iter(stream.response)))["progress"] == 0
                finally:
                    stream.close()
                assert parse(sse_events(client, "capacity-new")[0])["progress"] == 0
                return "https://ee.example/test.gif"

            gif.side_effect = while_running
            response = client.get(
                TEMP_URL, query_string={**query(), "task_id": "capacity-running"}
            )
            assert response.status_code == 200

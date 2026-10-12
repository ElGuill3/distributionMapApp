"""Completed progress retention through public GIF/SSE routes (T4b)."""

from contextlib import ExitStack
from unittest.mock import patch

import pytest

from backend.tests.test_api_query_validation import gif_patches, query
from backend.tests.test_progress_lifecycle import (
    MISSING,
    TEMP_URL,
    generate,
    sse_events,
)


@pytest.fixture
def client(monkeypatch):
    from app import app
    from extensions import limiter

    monkeypatch.setitem(app.config, "TESTING", True)
    monkeypatch.setattr(limiter, "enabled", False)
    return app.test_client()


@pytest.mark.parametrize("failure", [False, True])
def test_completed_queue_expires_at_retention_boundary(client, failure):
    from backend.services import gif_service

    task = f"retention-boundary-{failure}"
    with patch.object(gif_service.time, "monotonic", return_value=100) as clock:
        with ExitStack() as stack:
            _, gif, _, _ = gif_patches(stack, "era5_temp")
            if failure:
                gif.return_value = ""
            response = client.get(TEMP_URL, query_string={**query(), "task_id": task})
        assert response.status_code == (400 if failure else 200)
        clock.return_value = 100 + 3600
        assert sse_events(client, task) == [MISSING]


def test_late_subscriber_inside_retention_keeps_progress(client):
    from backend.services import gif_service

    with patch.object(gif_service.time, "monotonic", return_value=100) as clock:
        generate(client, TEMP_URL, "retention-late")
        clock.return_value = 100 + 3599
        events = sse_events(client, "retention-late")
    assert events[0].startswith(b'data: {"progress": 0,')
    assert sse_events(client, "retention-late") == [MISSING]


def test_ongoing_producer_does_not_expire_or_inherit_old_completion(client):
    from backend.services import gif_service

    task = "retention-replacement"
    with patch.object(gif_service.time, "monotonic", return_value=100) as clock:
        generate(client, TEMP_URL, task)
        clock.return_value = 3000
        with ExitStack() as stack:
            _, gif, _, _ = gif_patches(stack, "era5_temp")

            def active_builder(*args, **kwargs):
                clock.return_value = 8000
                # The replacement is running beyond the previous completion TTL.
                stream = client.get(f"/api/gif-progress/{task}", buffered=False)
                try:
                    assert next(iter(stream.response)).startswith(
                        b'data: {"progress": 0,'
                    )
                finally:
                    stream.close()
                return "https://ee.example/test.gif"

            gif.side_effect = active_builder
            response = client.get(TEMP_URL, query_string={**query(), "task_id": task})
        assert response.status_code == 200


def test_finished_queue_is_swept_without_subscriber_by_cleanup_daemon(client):
    from backend.services import gif_service

    task = "retention-periodic"
    with patch.object(gif_service.time, "monotonic", return_value=100) as clock:
        generate(client, TEMP_URL, task)
        clock.return_value = 3700
        with (
            patch.object(gif_service, "GIFS_DIR") as directory,
            patch.object(gif_service.time, "sleep", side_effect=InterruptedError),
        ):
            directory.glob.return_value = []
            with pytest.raises(InterruptedError):
                gif_service.cleanup_old_gifs()
        # Moving time backwards distinguishes the sweep from lookup expiry.
        clock.return_value = 100
        assert sse_events(client, task) == [MISSING]

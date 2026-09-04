"""Behavior and process-boundary tests for the local forecast supervisor."""

from __future__ import annotations

import os
import signal
import stat
import subprocess
import sys
import textwrap
import time
from pathlib import Path

import pytest

from scripts.run_local_forecast_stack import (
    API_HOST,
    API_MODULE,
    API_ORIGIN,
    API_PORT,
    APP_HOST,
    APP_ORIGIN,
    APP_PORT,
    APP_PREFLIGHT,
    WORKER_MODULE,
    LauncherError,
    ProcessSpec,
    SupervisorLock,
    build_settings,
    preflight,
    process_specs,
    supervise,
)


def _runtime(tmp_path: Path, *, secret: str = ""):
    app = tmp_path / "app"
    model = tmp_path / "model"
    for path in (
        app / ".venv/bin/python",
        app / "node_modules/.bin/tsc",
        model / ".venv/bin/python",
        model / "configs/model/bdctb_exogenous_qgb_v1.yaml",
        model / "bundle/manifest.json",
        model / "weights.yaml",
    ):
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text("fixture", encoding="utf-8")
    for path in (
        app / ".venv/bin/python",
        app / "node_modules/.bin/tsc",
        model / ".venv/bin/python",
    ):
        path.chmod(0o700)
    environment = {
        "BDCTB_MODEL_BUNDLE": str(model / "bundle"),
        "BDCTB_GEFS_WEIGHTS": str(model / "weights.yaml"),
        "PROVIDER_SECRET": secret,
    }
    return build_settings(app, model, environment)


def test_preflight_fails_before_commands_when_required_artifact_is_absent(tmp_path):
    settings = _runtime(tmp_path)
    settings.weights.unlink()
    calls = []

    with pytest.raises(LauncherError, match="GEFS spatial weights"):
        preflight(settings, runner=lambda *args, **kwargs: calls.append((args, kwargs)))

    assert calls == []


def test_preflight_runs_only_bounded_checks_and_current_typescript_build(tmp_path):
    settings = _runtime(tmp_path)
    calls = []

    def runner(command, **kwargs):
        calls.append((command, kwargs))
        return subprocess.CompletedProcess(command, 0, stdout="", stderr="")

    preflight(settings, runner=runner, port_check=lambda _host, _port: True)

    assert len(calls) == 3
    assert calls[0][0][:2] == [str(settings.app_python), "-c"]
    assert calls[1][0] == [
        str(settings.model_python),
        "-m",
        WORKER_MODULE,
        "--preflight",
    ]
    assert calls[2][0] == [str(settings.typescript), "--pretty", "false"]
    flattened = " ".join(token for call, _kwargs in calls for token in call).lower()
    forbidden = (" install ", "pip", "npm", "uv sync")
    assert all(token not in flattened for token in forbidden)
    assert all(kwargs["capture_output"] is True for _call, kwargs in calls)


def test_preflight_failure_never_exposes_captured_secret(tmp_path):
    secret = "provider-secret-must-not-appear"
    settings = _runtime(tmp_path, secret=secret)

    def runner(command, **_kwargs):
        return subprocess.CompletedProcess(command, 9, stdout=secret, stderr=secret)

    with pytest.raises(LauncherError) as failure:
        preflight(settings, runner=runner, port_check=lambda _host, _port: True)

    assert secret not in str(failure.value)


def test_app_preflight_checks_local_authorization_without_provider_calls(tmp_path):
    credentials = tmp_path / "application-default.json"
    credentials.write_text("fixture", encoding="ascii")
    environment = {
        **os.environ,
        "GEE_PROJECT": "offline-test-project",
        "GOOGLE_APPLICATION_CREDENTIALS": str(credentials),
        "HOME": str(tmp_path),
    }

    result = subprocess.run(
        [sys.executable, "-c", APP_PREFLIGHT],
        cwd=tmp_path,
        env=environment,
        capture_output=True,
        text=True,
        timeout=10,
        check=False,
    )

    assert result.returncode == 0
    assert result.stdout == result.stderr == ""


def test_process_contract_is_exact_loopback_and_starts_three_independent_children(
    tmp_path,
):
    settings = _runtime(tmp_path)
    specs = process_specs(settings)
    assert [spec.name for spec in specs] == ["forecast-api", "forecast-worker", "app"]

    api, worker, app = specs
    assert api.command == (
        str(settings.model_python),
        "-m",
        API_MODULE,
        "--host",
        API_HOST,
        "--port",
        str(API_PORT),
        "--allow-origin",
        APP_ORIGIN,
        "--cache",
        str(settings.cache_path),
    )
    assert worker.command == (str(settings.model_python), "-m", WORKER_MODULE)
    assert app.environment["BDCTB_FORECAST_API_BASE_URL"] == API_ORIGIN
    assert ("--host", APP_HOST) == (
        app.command[app.command.index("--host")],
        app.command[app.command.index("--host") + 1],
    )
    assert ("--port", str(APP_PORT)) == (
        app.command[app.command.index("--port")],
        app.command[app.command.index("--port") + 1],
    )
    assert WORKER_MODULE not in " ".join(api.command + app.command)
    assert API_MODULE not in " ".join(worker.command)


def test_duplicate_supervisor_is_rejected_without_starting_children(tmp_path):
    lock_path = tmp_path / "supervisor.lock"
    with SupervisorLock(lock_path):
        with pytest.raises(LauncherError, match="already supervised"):
            with SupervisorLock(lock_path):
                raise AssertionError("duplicate lock unexpectedly acquired")


class FakeChild:
    def __init__(self, returncode=None, *, timeout=False):
        self.returncode = returncode
        self.timeout = timeout
        self.terminated = 0
        self.killed = 0

    def poll(self):
        return self.returncode

    def terminate(self):
        self.terminated += 1
        if not self.timeout:
            self.returncode = -signal.SIGTERM

    def wait(self, timeout):
        if self.timeout and not self.killed:
            raise subprocess.TimeoutExpired("fake", timeout)
        return self.returncode

    def kill(self):
        self.killed += 1
        self.returncode = -signal.SIGKILL


def test_failure_propagates_and_cleanup_targets_only_started_children(tmp_path):
    settings = _runtime(tmp_path)
    specs = process_specs(settings)
    unrelated = FakeChild()
    started = [FakeChild(), FakeChild(), FakeChild(17)]
    calls = []
    started_reported = []

    def popen(command, **kwargs):
        calls.append((command, kwargs))
        return started[len(calls) - 1]

    assert (
        supervise(
            specs,
            tmp_path / "logs",
            popen=popen,
            sleep=lambda _n: None,
            on_started=lambda: started_reported.append(True),
        )
        == 17
    )
    assert len(calls) == 3
    assert started_reported == []
    assert [child.terminated for child in started] == [1, 1, 0]
    assert unrelated.terminated == unrelated.killed == 0


def test_signal_cleanup_escalates_only_a_stuck_owned_child(tmp_path):
    settings = _runtime(tmp_path)
    children = [FakeChild(timeout=True), FakeChild()]
    calls = 0

    def popen(_command, **_kwargs):
        nonlocal calls
        child = children[calls]
        calls += 1
        return child

    assert (
        supervise(
            process_specs(settings)[:2],
            tmp_path / "logs",
            popen=popen,
            stop_requested=lambda: True,
        )
        == 0
    )
    assert children[0].terminated == children[0].killed == 1
    assert children[1].terminated == 1
    assert children[1].killed == 0
    assert all(
        stat.S_IMODE(path.stat().st_mode) == 0o600
        for path in (tmp_path / "logs").iterdir()
    )


def test_real_harness_proves_failure_cleanup_and_unrelated_survival(tmp_path):
    child_script = tmp_path / "fake_child.py"
    child_script.write_text(
        textwrap.dedent(
            """
            import pathlib
            import signal
            import sys
            import time

            mode, marker = sys.argv[1], pathlib.Path(sys.argv[2])
            marker.with_suffix(".ready").write_text("ready", encoding="ascii")

            def stop(_signum, _frame):
                marker.with_suffix(".stopped").write_text("stopped", encoding="ascii")
                raise SystemExit(0)

            signal.signal(signal.SIGTERM, stop)
            if mode == "fail":
                time.sleep(0.15)
                raise SystemExit(23)
            while True:
                time.sleep(0.05)
            """
        ),
        encoding="utf-8",
    )
    environment = dict(os.environ)
    markers = [tmp_path / name for name in ("api", "worker", "app")]
    specs = tuple(
        ProcessSpec(
            name,
            (
                sys.executable,
                str(child_script),
                "fail" if name == "app" else "wait",
                str(marker),
            ),
            tmp_path,
            environment,
        )
        for name, marker in zip(("api", "worker", "app"), markers, strict=True)
    )
    unrelated_marker = tmp_path / "unrelated"
    unrelated = subprocess.Popen(
        [sys.executable, str(child_script), "wait", str(unrelated_marker)],
        cwd=tmp_path,
        env=environment,
        stdout=subprocess.DEVNULL,
        stderr=subprocess.DEVNULL,
    )
    try:
        result = supervise(specs, tmp_path / "logs", sleep=lambda _n: time.sleep(0.02))
        assert result == 23
        assert all(marker.with_suffix(".ready").is_file() for marker in markers)
        assert markers[0].with_suffix(".stopped").is_file()
        assert markers[1].with_suffix(".stopped").is_file()
        assert unrelated.poll() is None
    finally:
        unrelated.terminate()
        unrelated.wait(timeout=5)


def test_worker_is_not_started_by_an_api_or_browser_request(tmp_path):
    settings = _runtime(tmp_path)
    api, worker, app = process_specs(settings)
    assert worker.command not in (api.command, app.command)
    assert worker.name == "forecast-worker"
    assert "--preflight" not in worker.command
    assert all("request" not in token.lower() for token in worker.command)

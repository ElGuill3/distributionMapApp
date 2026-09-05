"""Behavior and process-boundary tests for the local forecast supervisor."""

from __future__ import annotations

import io
import json
import os
import signal
import stat
import subprocess
import sys
import textwrap
import threading
import time
from dataclasses import replace
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
    APP_PREFLIGHT_MODULE,
    DEFAULT_MODEL_REPOSITORY_NAME,
    LOG_FILE_MAX_BYTES,
    LOG_FILES_PER_PROCESS,
    MODEL_RUNTIME_DESCRIPTOR,
    ROOT,
    WORKER_MODULE,
    LauncherError,
    ProcessSpec,
    SupervisorLock,
    build_parser,
    build_settings,
    preflight,
    process_specs,
    resolve_app_root,
    resolve_runtime_roots,
    supervise,
)


def _runtime(tmp_path: Path, *, secret: str = ""):
    app = tmp_path / "app"
    model = tmp_path / "model"
    for path in (
        app / ".venv/bin/python",
        app / "node_modules/.bin/tsc",
        model / ".venv/bin/python",
        model / "configs/model/bdctb_runtime_paths_v1.json",
        model / "configs/model/bdctb_exogenous_qgb_v1.yaml",
        model / "bundle/manifest.json",
        model / "weights.yaml",
    ):
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text("fixture", encoding="utf-8")
    (model / MODEL_RUNTIME_DESCRIPTOR).write_text(
        json.dumps(
            {
                "schema_version": "bdctb-operational-runtime-paths/v1",
                "model_config": "configs/model/bdctb_exogenous_qgb_v1.yaml",
                "model_bundle": "runs/bdctb-exogenous-qgb-real-v1-calibrated-20260730",
                "gefs_weights": "configs/model/usumacinta_bdctb_precip_grid_v1.yaml",
                "state_root": "var/operational/bdctb",
                "forecast_cache": "var/forecasts/bdctb/latest-v1.json",
            }
        ),
        encoding="utf-8",
    )
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


def test_app_root_and_default_model_repo_resolve_from_checkout_subdirectory():
    app_root, model_root = resolve_runtime_roots(None, start=ROOT / "tests")

    assert resolve_app_root(ROOT / "tests") == ROOT
    assert app_root == ROOT
    assert model_root == ROOT.parent / DEFAULT_MODEL_REPOSITORY_NAME


def test_parser_accepts_explicit_model_repo():
    assert build_parser().parse_args([]).model_repo is None
    assert build_parser().parse_args(
        ["--model-repo", "../alternate-model"]
    ).model_repo == Path("../alternate-model")


def test_explicit_relative_model_repo_resolves_from_invocation_directory():
    invocation_root = ROOT / "tests"
    app_root, model_root = resolve_runtime_roots(
        Path("../alternate-model"), start=invocation_root
    )

    assert app_root == ROOT
    assert model_root == (invocation_root / "../alternate-model").resolve()


def test_app_root_never_falls_back_to_an_installed_module_path(tmp_path):
    installed_module_root = tmp_path / "site-packages"
    installed_module_root.mkdir()

    with pytest.raises(LauncherError, match="distributionMapApp checkout"):
        resolve_app_root(tmp_path / "outside", source_root=installed_module_root)


def test_installed_distribution_map_command_exposes_help_without_starting_stack():
    command_name = "distribution-map.exe" if os.name == "nt" else "distribution-map"
    command = Path(sys.executable).parent / command_name

    assert command.is_file(), "uv must install the project command before tests run"
    result = subprocess.run(
        [str(command), "--help"],
        cwd=ROOT,
        capture_output=True,
        text=True,
        timeout=10,
        check=False,
    )

    assert result.returncode == 0
    assert "Run the local app, cached Forecast API" in result.stdout
    assert "--model-repo" in result.stdout
    assert result.stderr == ""


def test_absent_artifact_environment_uses_canonical_tracked_paths(tmp_path):
    overridden = _runtime(tmp_path)
    settings = build_settings(overridden.app_root, overridden.model_root, {})

    assert settings.model_config == overridden.model_root / (
        "configs/model/bdctb_exogenous_qgb_v1.yaml"
    )
    assert settings.model_bundle == overridden.model_root / (
        "runs/bdctb-exogenous-qgb-real-v1-calibrated-20260730"
    )
    assert settings.weights == overridden.model_root / (
        "configs/model/usumacinta_bdctb_precip_grid_v1.yaml"
    )
    assert settings.state_root == overridden.model_root / "var/operational/bdctb"
    assert settings.cache_path == overridden.model_root / (
        "var/forecasts/bdctb/latest-v1.json"
    )


def test_explicit_artifact_overrides_still_win(tmp_path):
    settings = _runtime(tmp_path)

    assert settings.model_bundle == settings.model_root / "bundle"
    assert settings.weights == settings.model_root / "weights.yaml"


def test_unsafe_runtime_descriptor_fails_before_any_child_can_start(tmp_path):
    settings = _runtime(tmp_path)
    descriptor = settings.model_root / MODEL_RUNTIME_DESCRIPTOR
    value = json.loads(descriptor.read_bytes())
    value["model_bundle"] = "../outside"
    descriptor.write_text(json.dumps(value), encoding="utf-8")

    with pytest.raises(LauncherError, match="unsafe path"):
        build_settings(settings.app_root, settings.model_root, {})


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
    assert calls[0][0] == [
        str(settings.app_python),
        "-m",
        APP_PREFLIGHT_MODULE,
    ]
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


def test_tampered_bundle_preflight_fails_before_typescript_or_children(tmp_path):
    settings = _runtime(tmp_path)
    (settings.model_bundle / "manifest.json").write_text("tampered", encoding="ascii")
    calls = []

    def runner(command, **kwargs):
        calls.append(command)
        return subprocess.CompletedProcess(
            command,
            2 if WORKER_MODULE in command else 0,
            stdout="",
            stderr="",
        )

    with pytest.raises(LauncherError, match="model dependencies, artifacts"):
        preflight(settings, runner=runner, port_check=lambda _host, _port: True)

    assert calls == [
        [str(settings.app_python), "-m", APP_PREFLIGHT_MODULE],
        [str(settings.model_python), "-m", WORKER_MODULE, "--preflight"],
    ]


def test_preflight_failure_never_exposes_captured_secret(tmp_path):
    secret = "provider-secret-must-not-appear"
    settings = _runtime(tmp_path, secret=secret)

    def runner(command, **_kwargs):
        return subprocess.CompletedProcess(command, 9, stdout=secret, stderr=secret)

    with pytest.raises(LauncherError) as failure:
        preflight(settings, runner=runner, port_check=lambda _host, _port: True)

    assert secret not in str(failure.value)


def test_app_preflight_imports_real_boundary_without_runtime_side_effects(tmp_path):
    credentials = tmp_path / "application-default.json"
    credentials.write_text("fixture", encoding="ascii")
    environment = {
        **os.environ,
        "GEE_PROJECT": "offline-test-project",
        "GOOGLE_APPLICATION_CREDENTIALS": str(credentials),
        "HOME": str(tmp_path),
        "BASE_DIR_OVERRIDE": str(tmp_path / "runtime"),
    }

    result = subprocess.run(
        [
            sys.executable,
            "-c",
            (
                "import app_preflight, threading; "
                "result = app_preflight.main(); "
                "raise SystemExit(result if threading.active_count() == 1 else 9)"
            ),
        ],
        cwd=ROOT,
        env=environment,
        capture_output=True,
        text=True,
        timeout=30,
        check=False,
    )

    assert result.returncode == 0
    assert result.stdout == result.stderr == ""
    assert not (tmp_path / "runtime").exists()


def test_app_preflight_detects_missing_transitive_dependency(tmp_path):
    credentials = tmp_path / "application-default.json"
    credentials.write_text("fixture", encoding="ascii")
    blocker = tmp_path / "blocker"
    blocker.mkdir()
    (blocker / "sitecustomize.py").write_text(
        textwrap.dedent(
            """
            import builtins

            original_import = builtins.__import__

            def guarded_import(name, *args, **kwargs):
                if name == "flask_limiter" or name.startswith("flask_limiter."):
                    raise ImportError("withheld transitive dependency")
                return original_import(name, *args, **kwargs)

            builtins.__import__ = guarded_import
            """
        ),
        encoding="utf-8",
    )
    environment = {
        **os.environ,
        "GEE_PROJECT": "offline-test-project",
        "GOOGLE_APPLICATION_CREDENTIALS": str(credentials),
        "HOME": str(tmp_path),
        "PYTHONPATH": str(blocker),
        "BASE_DIR_OVERRIDE": str(tmp_path / "runtime"),
    }
    settings = replace(
        _runtime(tmp_path),
        app_root=ROOT,
        app_python=Path(sys.executable),
        environment=environment,
    )
    calls = []

    def runner(command, **kwargs):
        calls.append(command)
        return subprocess.run(command, **kwargs)

    with pytest.raises(LauncherError) as failure:
        preflight(settings, runner=runner, port_check=lambda _host, _port: True)

    assert calls == [[sys.executable, "-m", APP_PREFLIGHT_MODULE]]
    assert "flask_limiter" not in str(failure.value)
    assert not (tmp_path / "runtime").exists()


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
    def __init__(self, returncode=None, *, timeout=False, output: bytes = b""):
        self.returncode = returncode
        self.timeout = timeout
        self.terminated = 0
        self.killed = 0
        self.stdout = io.BytesIO(output)

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
    assert stat.S_IMODE((tmp_path / "logs").stat().st_mode) == 0o700


def test_large_output_is_bounded_private_and_retains_tail_without_pump_leaks(
    tmp_path,
):
    child_script = tmp_path / "large_output.py"
    tail = b"useful-final-tail-evidence"
    child_script.write_text(
        textwrap.dedent(
            f"""
            import os

            chunk = b"x" * (64 * 1024)
            for _ in range(52):
                os.write(1, chunk)
            os.write(1, {tail!r})
            raise SystemExit(31)
            """
        ),
        encoding="utf-8",
    )
    spec = ProcessSpec(
        "large-child",
        (sys.executable, str(child_script)),
        tmp_path,
        dict(os.environ),
    )
    pump_names_before = {
        thread.name
        for thread in threading.enumerate()
        if thread.name.startswith("bdctb-log-pump-")
    }

    assert (
        supervise((spec,), tmp_path / "logs", sleep=lambda _n: time.sleep(0.01)) == 31
    )

    logs = sorted((tmp_path / "logs").iterdir())
    assert 1 <= len(logs) <= LOG_FILES_PER_PROCESS
    assert all(path.stat().st_size <= LOG_FILE_MAX_BYTES for path in logs)
    assert all(stat.S_IMODE(path.stat().st_mode) == 0o600 for path in logs)
    assert stat.S_IMODE((tmp_path / "logs").stat().st_mode) == 0o700
    assert tail in (tmp_path / "logs/large-child.log").read_bytes()
    assert {
        thread.name
        for thread in threading.enumerate()
        if thread.name.startswith("bdctb-log-pump-")
    } == pump_names_before


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

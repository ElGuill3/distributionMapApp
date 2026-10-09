"""Deterministic app-only launcher contract tests without provider or model use."""

from __future__ import annotations

import functools
import json
import os
import signal
import subprocess
import sys
import time
import tomllib
from pathlib import Path

import pytest

import scripts.run_app as run_app
from scripts.run_local_forecast_stack import (
    APP_HOST,
    APP_PORT,
    APP_PREFLIGHT_MODULE,
    ROOT,
    LauncherError,
)


def _app_settings(tmp_path: Path):
    for path in (
        tmp_path / ".venv/bin/python",
        tmp_path / "node_modules/.bin/tsc",
        tmp_path / "scripts/build-typescript.mjs",
    ):
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text("fixture", encoding="utf-8")
    for path in (tmp_path / ".venv/bin/python", tmp_path / "node_modules/.bin/tsc"):
        path.chmod(0o700)
    return run_app.build_app_settings(tmp_path, {"PASSTHROUGH": "1"})


def test_pyproject_entry_point_targets_the_app_only_launcher():
    document = tomllib.loads((ROOT / "pyproject.toml").read_text(encoding="utf-8"))

    assert document["project"]["scripts"]["distribution-map"] == (
        "scripts.run_app:main"
    )


def test_installed_distribution_map_command_exposes_app_only_help():
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
    assert "frontend" in result.stdout
    assert "127.0.0.1:5000" in result.stdout
    assert "--model-repo" not in result.stdout
    assert result.stderr == ""


def test_app_settings_resolve_without_any_model_configuration(tmp_path):
    settings = _app_settings(tmp_path)

    assert settings.app_root == tmp_path
    assert settings.app_python == tmp_path / ".venv/bin/python"
    assert settings.build_script == tmp_path / "scripts/build-typescript.mjs"
    assert settings.typescript == tmp_path / "node_modules/.bin/tsc"
    assert settings.runtime_root == tmp_path / ".cache/bdctb-local-app"
    assert settings.environment == {"PASSTHROUGH": "1"}


def test_app_spec_binds_loopback_and_injects_no_model_configuration(tmp_path):
    settings = _app_settings(tmp_path)
    spec = run_app.app_process_spec(settings)

    assert spec.name == "app"
    assert spec.cwd == tmp_path
    assert spec.command == (
        str(tmp_path / ".venv/bin/python"),
        "-m",
        "flask",
        "--app",
        "app",
        "run",
        "--host",
        APP_HOST,
        "--port",
        str(APP_PORT),
        "--no-debugger",
        "--no-reload",
    )
    assert spec.environment["FLASK_DEBUG"] == "false"
    assert spec.environment["_DISTRIBUTIONMAPAPP_DEPENDENCY_PREFLIGHT"] == "0"
    assert spec.environment["PASSTHROUGH"] == "1"
    for key in (
        "BDCTB_FORECAST_API_BASE_URL",
        "BDCTB_STATE_ROOT",
        "BDCTB_CACHE_PATH",
        "BDCTB_MODEL_CONFIG",
        "BDCTB_MODEL_BUNDLE",
        "BDCTB_GEFS_WEIGHTS",
    ):
        assert key not in spec.environment


def test_preflight_runs_dependency_check_then_clean_build_only(tmp_path):
    settings = _app_settings(tmp_path)
    calls = []

    def runner(command, **kwargs):
        calls.append((command, kwargs))
        return subprocess.CompletedProcess(command, 0, stdout="", stderr="")

    run_app.preflight(settings, runner=runner, port_check=lambda _host, _port: True)

    assert calls == [
        (
            [str(settings.app_python), "-m", APP_PREFLIGHT_MODULE],
            dict(
                cwd=settings.app_root,
                env={"PASSTHROUGH": "1"},
                capture_output=True,
                text=True,
                timeout=run_app.PREFLIGHT_TIMEOUT_SECONDS,
                check=False,
            ),
        ),
        (
            [settings.node, str(settings.build_script)],
            dict(
                cwd=settings.app_root,
                env={"PASSTHROUGH": "1"},
                capture_output=True,
                text=True,
                timeout=run_app.BUILD_TIMEOUT_SECONDS,
                check=False,
            ),
        ),
    ]
    flattened = " ".join(token for command, _kwargs in calls for token in command)
    assert APP_PREFLIGHT_MODULE in flattened
    assert "flood_research" not in flattened
    assert " install " not in flattened
    assert "npm" not in flattened
    assert "pip" not in flattened


def test_preflight_app_dependency_failure_blocks_build_and_backend(tmp_path):
    settings = _app_settings(tmp_path)
    calls = []

    def runner(command, **_kwargs):
        calls.append(command)
        return subprocess.CompletedProcess(
            command, 2 if APP_PREFLIGHT_MODULE in command else 0, stdout="", stderr=""
        )

    with pytest.raises(LauncherError, match="app dependencies or Earth Engine"):
        run_app.preflight(settings, runner=runner, port_check=lambda _h, _p: True)

    assert calls == [[str(settings.app_python), "-m", APP_PREFLIGHT_MODULE]]


def test_preflight_build_failure_propagates_and_backend_never_starts(tmp_path):
    settings = _app_settings(tmp_path)
    calls = []

    def runner(command, **_kwargs):
        calls.append(command)
        return subprocess.CompletedProcess(
            command, 1 if settings.node in command else 0, stdout="", stderr=""
        )

    with pytest.raises(LauncherError, match="frontend did not build"):
        run_app.preflight(settings, runner=runner, port_check=lambda _h, _p: True)

    assert len(calls) == 2
    assert APP_PREFLIGHT_MODULE not in calls[1]


def test_preflight_rejects_occupied_loopback_port_without_any_process(tmp_path):
    settings = _app_settings(tmp_path)
    calls = []

    with pytest.raises(LauncherError, match="port"):
        run_app.preflight(
            settings,
            runner=lambda *args, **kwargs: calls.append((args, kwargs)),
            port_check=lambda _host, _port: False,
        )

    assert calls == []


def test_main_reports_failure_with_exit_code_two_without_starting_children(
    tmp_path, monkeypatch, capsys
):
    settings = _app_settings(tmp_path)

    def failing_preflight(*_args, **_kwargs):
        raise LauncherError("simulated preflight failure")

    monkeypatch.setattr(run_app, "build_app_settings", lambda *_args: settings)
    monkeypatch.setattr(run_app, "preflight", failing_preflight)
    monkeypatch.setattr(
        run_app,
        "supervise",
        lambda *_args, **_kwargs: pytest.fail("children must never start"),
    )

    assert run_app.main([]) == 2
    assert "simulated preflight failure" in capsys.readouterr().err


def test_main_supervises_exactly_one_foreground_child(tmp_path, monkeypatch):
    settings = _app_settings(tmp_path)
    supervised = []
    monkeypatch.setattr(run_app, "build_app_settings", lambda *_args: settings)
    monkeypatch.setattr(run_app, "preflight", lambda *_args, **_kwargs: None)

    def fake_supervise(specs, log_dir, **_kwargs):
        supervised.append((list(specs), log_dir))
        return 0

    monkeypatch.setattr(run_app, "supervise", fake_supervise)

    assert run_app.main([]) == 0
    assert len(supervised) == 1
    specs, log_dir = supervised[0]
    assert [spec.name for spec in specs] == ["app"]
    assert log_dir == settings.runtime_root / "logs"
    spec = run_app.app_process_spec(settings)
    assert spec.command[spec.command.index("--host") + 1] == APP_HOST


_LAUNCHER_DRIVER = '''\
"""Foreground launcher harness: runs run_app.main against a temporary app root."""
import functools
import os
import sys
from pathlib import Path

repo_root, app_root, marker_path = sys.argv[1:4]
sys.path.insert(0, repo_root)

import scripts.run_app as run_app

app_root = Path(app_root)
settings = run_app.AppSettings(
    app_root=app_root,
    app_python=app_root / ".venv" / "bin" / "python",
    node=sys.executable,
    build_script=app_root / "fake-build-driver.py",
    typescript=app_root / "node_modules" / ".bin" / "tsc",
    runtime_root=app_root / ".cache" / "bdctb-local-app",
    environment={**os.environ, "FAKE_BUILD_MARKER": marker_path},
)
run_app.build_app_settings = lambda *_args, **_kwargs: settings
run_app.preflight = functools.partial(
    run_app.preflight, port_check=lambda *_args: True
)
raise SystemExit(run_app.main([]))
'''


_FAKE_BUILD_DRIVER = '''\
"""Fake clean build driver: records a long-lived descendant, then waits."""
import json
import os
import subprocess
import sys
import time
from pathlib import Path

marker = Path(os.environ["FAKE_BUILD_MARKER"])
ignores_sigterm = os.environ.get("FAKE_GRANDCHILD_IGNORES_SIGTERM") == "1"
if ignores_sigterm:
    ready = Path(os.environ["FAKE_GRANDCHILD_READY"])
    grandchild_code = (
        "import signal, time\\n"
        "signal.signal(signal.SIGTERM, signal.SIG_IGN)\\n"
        f"open({str(ready)!r}, 'w').write('ready')\\n"
        "time.sleep(120)\\n"
    )
else:
    grandchild_code = "import time; time.sleep(120)"
grandchild = subprocess.Popen(
    [sys.executable, "-c", grandchild_code],
    stdout=subprocess.DEVNULL,
    stderr=subprocess.DEVNULL,
)
if ignores_sigterm:
    # Publish the marker only after the grandchild confirmed its SIGTERM
    # handler is installed; otherwise the launcher SIGTERM could race the
    # handler registration and the escalation test would pass vacuously.
    deadline = time.monotonic() + 30
    while not ready.exists():
        if time.monotonic() > deadline:
            raise SystemExit("grandchild never installed its SIGTERM handler")
        time.sleep(0.02)
marker.write_text(json.dumps({"driver": os.getpid(), "grandchild": grandchild.pid}))
time.sleep(120)
'''


def _write_startup_fixture(tmp_path: Path) -> tuple[Path, Path]:
    (tmp_path / ".venv" / "bin").mkdir(parents=True, exist_ok=True)
    fake_python = tmp_path / ".venv" / "bin" / "python"
    fake_python.write_text("#!/bin/sh\nexit 0\n", encoding="utf-8")
    fake_python.chmod(0o700)
    (tmp_path / "node_modules" / ".bin").mkdir(parents=True, exist_ok=True)
    fake_tsc = tmp_path / "node_modules" / ".bin" / "tsc"
    fake_tsc.write_text("#!/bin/sh\nexit 0\n", encoding="utf-8")
    fake_tsc.chmod(0o700)
    marker = tmp_path / "startup-build-marker.json"
    build_driver = tmp_path / "fake-build-driver.py"
    build_driver.write_text(_FAKE_BUILD_DRIVER, encoding="utf-8")
    driver = tmp_path / "launcher-driver.py"
    driver.write_text(_LAUNCHER_DRIVER, encoding="utf-8")
    return marker, driver


def _pid_is_gone(pid: int, timeout: float) -> bool:
    deadline = time.monotonic() + timeout
    while time.monotonic() < deadline:
        try:
            os.kill(pid, 0)
        except ProcessLookupError:
            return True
        time.sleep(0.05)
    try:
        os.kill(pid, 0)
    except ProcessLookupError:
        return True
    return False


def _run_sigterm_during_build(tmp_path: Path, *, env_extra: dict[str, str]):
    marker, driver = _write_startup_fixture(tmp_path)
    environment = dict(os.environ, **env_extra)
    ready_path = tmp_path / "grandchild-ready.txt"
    environment["FAKE_GRANDCHILD_READY"] = str(ready_path)
    process = subprocess.Popen(
        [sys.executable, str(driver), str(ROOT), str(tmp_path), str(marker)],
        cwd=ROOT,
        env=environment,
        stdout=subprocess.PIPE,
        stderr=subprocess.PIPE,
        text=True,
    )
    pids: dict[str, int] = {}
    try:
        deadline = time.monotonic() + 30
        while time.monotonic() < deadline:
            if marker.exists():
                pids = json.loads(marker.read_text(encoding="utf-8"))
                break
            if process.poll() is not None:
                pytest.fail("launcher exited before the fake build started")
            time.sleep(0.05)
        assert pids, "fake build driver never recorded its descendant"
        if env_extra.get("FAKE_GRANDCHILD_IGNORES_SIGTERM") == "1":
            assert ready_path.exists(), (
                "grandchild must install its SIGTERM handler before the "
                "marker is published"
            )
        os.kill(pids["grandchild"], 0)  # descendant alive while the build runs

        process.terminate()  # SIGTERM to the launcher process alone
        process.wait(timeout=30)

        assert _pid_is_gone(pids["grandchild"], 10), (
            "build descendant survived the launcher SIGTERM"
        )
        assert process.returncode == 2, (
            "launcher must shut down gracefully, not die from the default signal"
        )
    finally:
        for pid in pids.values():
            try:
                os.kill(pid, signal.SIGKILL)
            except (ProcessLookupError, PermissionError):
                pass
        if process.poll() is None:
            process.kill()
            process.wait(timeout=10)


def test_sigterm_to_launcher_alone_during_build_kills_startup_descendants(
    tmp_path,
):
    """SIGTERM to the launcher alone during the build step leaves no descendants."""
    _run_sigterm_during_build(tmp_path, env_extra={})


def test_sigterm_escalates_to_sigkill_for_descendants_ignoring_sigterm(tmp_path):
    """Stubborn build descendants are SIGKILLed, never left running."""
    _run_sigterm_during_build(
        tmp_path, env_extra={"FAKE_GRANDCHILD_IGNORES_SIGTERM": "1"}
    )


def test_main_installs_signal_handlers_before_startup_preflight(tmp_path, monkeypatch):
    """Signal cleanup covers the whole startup, including preflight and build."""
    settings = _app_settings(tmp_path)
    order = []
    installed = []

    def fake_signal(signum, handler):
        installed.append((signum, handler))
        return signal.SIG_DFL

    def fake_preflight(*_args, **_kwargs):
        order.append("preflight")

    monkeypatch.setattr(run_app.signal, "signal", fake_signal)
    monkeypatch.setattr(run_app, "build_app_settings", lambda *_args: settings)
    monkeypatch.setattr(run_app, "preflight", fake_preflight)
    monkeypatch.setattr(run_app, "supervise", lambda *_args, **_kwargs: 0)

    assert run_app.main([]) == 0

    assert [signum for signum, _handler in installed] == [
        signal.SIGINT,
        signal.SIGTERM,
        signal.SIGINT,
        signal.SIGTERM,
    ]
    assert order == ["preflight"]
    handler = installed[1][1]
    assert callable(handler)
    # The build-phase handler must terminate startup children, not only set the flag.
    assert "_terminate_startup_children" in " ".join(handler.__code__.co_names)


def test_startup_step_never_spawns_once_startup_abort_is_requested():
    """A signal before registration must not spawn a new startup child."""
    run_app._STARTUP_ABORTED.set()
    spawned = []

    def spy_popen(command, **_kwargs):
        spawned.append(list(command))
        return subprocess.Popen([sys.executable, "-c", "import sys; sys.exit(0)"])

    try:
        with pytest.raises(LauncherError, match="abort"):
            run_app._run_startup_step(["would-be-child"], popen=spy_popen)
    finally:
        run_app._STARTUP_ABORTED.clear()

    assert spawned == [], "startup step spawned a child after abort was requested"


def test_startup_step_cancels_child_when_abort_lands_during_registration():
    """A signal between spawn and registration cancels the child immediately."""
    real_popen = subprocess.Popen
    children = []

    def racing_popen(command, **kwargs):
        child = real_popen(command, **kwargs)
        children.append(child)
        # Simulate the foreground signal handler firing in the window between
        # spawning the child and registering it for cleanup.
        run_app._STARTUP_ABORTED.set()
        return child

    command = [sys.executable, "-c", "import time; time.sleep(10)"]
    started = time.monotonic()
    try:
        with pytest.raises(LauncherError, match="abort"):
            run_app._run_startup_step(command, timeout=10, popen=racing_popen)
        elapsed = time.monotonic() - started
    finally:
        run_app._STARTUP_ABORTED.clear()
        for child in children:
            if child.poll() is None:
                child.kill()
                child.wait(timeout=10)

    assert elapsed < 10, "startup step waited for the child despite the abort"
    for child in children:
        assert _pid_is_gone(child.pid, 10), "cancelled child must be terminated"


def test_preflight_aborts_before_spawning_the_build_after_a_signal(tmp_path):
    """An abort during the dependency check must never spawn the build step."""
    settings = _app_settings(tmp_path)
    spawned = []

    def racing_popen(command, **kwargs):
        spawned.append(list(command))
        benign = [sys.executable, "-c", "import sys; sys.exit(0)"]
        child = subprocess.Popen(benign, **kwargs)
        if APP_PREFLIGHT_MODULE in command:
            # The signal lands while the dependency check step is running.
            run_app._STARTUP_ABORTED.set()
        return child

    runner = functools.partial(run_app._run_startup_step, popen=racing_popen)
    try:
        with pytest.raises(LauncherError, match="abort"):
            run_app.preflight(
                settings, runner=runner, port_check=lambda _host, _port: True
            )
    finally:
        run_app._STARTUP_ABORTED.clear()

    assert settings.build_script not in [
        token for command in spawned for token in command
    ], "the build step was spawned after abort was requested"

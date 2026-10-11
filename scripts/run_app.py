"""Build the frontend and serve the Flask app locally without the model stack.

The public app-only command compiles the TypeScript frontend through the clean
deterministic build driver, validates the application dependency boundary, and
refreshes CONAGUA station data before Flask loads its catalog, and then serves
Flask in the foreground on http://127.0.0.1:5000. If downloads fail, usable local
station data is retained with a warning; startup stops if none is available.
It never requires the sibling model repository and
never starts the Forecast API or the automatic worker; those remain available
through the deferred ``scripts/run_local_forecast_stack.py`` supervisor.
"""

from __future__ import annotations

import argparse
import os
import shutil
import signal
import subprocess
import sys
import threading
from collections.abc import Callable, Mapping, Sequence
from dataclasses import dataclass
from pathlib import Path

from scripts.run_local_forecast_stack import (
    APP_HOST,
    APP_PORT,
    APP_PREFLIGHT_MODULE,
    LauncherError,
    ProcessSpec,
    SupervisorLock,
    _port_is_free,
    _require_file,
    resolve_app_root,
    supervise,
)

APP_ORIGIN = f"http://{APP_HOST}:{APP_PORT}"
APP_RUNTIME_ROOT = Path(".cache/bdctb-local-app")
NODE_EXECUTABLE = "node"
BUILD_SCRIPT = Path("scripts/build-typescript.mjs")
PREFLIGHT_TIMEOUT_SECONDS = 30
BUILD_TIMEOUT_SECONDS = 300
STATION_BOOTSTRAP_MODULE = "scripts.bootstrap_stations"

# Startup children currently running under preflight/build. The foreground
# signal-cleanup requirement covers startup too: a SIGTERM to the launcher
# alone must not orphan the compiler or build driver descendants.
_STARTUP_CHILDREN: set[subprocess.Popen[bytes]] = set()
# Set when the foreground signal handler requested startup cleanup.
_STARTUP_ABORTED = threading.Event()


def _signal_process_group(pgid: int, sig: int) -> None:
    kill_group = getattr(os, "killpg", None)
    if kill_group is None:
        return
    try:
        kill_group(pgid, sig)
    except OSError:
        return


def _terminate_startup_children() -> None:
    _STARTUP_ABORTED.set()
    for child in tuple(_STARTUP_CHILDREN):
        if child.poll() is None:
            _signal_process_group(child.pid, signal.SIGTERM)


def _reap_startup_children() -> None:
    for child in tuple(_STARTUP_CHILDREN):
        if child.poll() is None:
            _signal_process_group(child.pid, signal.SIGKILL)


def _run_startup_step(
    command: Sequence[str],
    *,
    cwd: Path | None = None,
    env: Mapping[str, str] | None = None,
    capture_output: bool = False,
    text: bool = False,
    timeout: float | None = None,
    check: bool = False,
    popen: Callable[..., subprocess.Popen[bytes]] = subprocess.Popen,
) -> subprocess.CompletedProcess[str]:
    """Run one startup child in its own process group so it can be cleaned up.

    ``check`` is accepted for ``subprocess.run`` compatibility and intentionally
    ignored: startup failures are reported through ``LauncherError``.

    Startup is abort-aware: no child is spawned once the foreground signal
    handler requested cleanup, and a signal landing in the window between
    spawning and registering a child cancels it immediately instead of
    waiting for completion or timeout.
    """
    if _STARTUP_ABORTED.is_set():
        raise LauncherError("startup aborted before the step could start")
    child = popen(
        list(command),
        cwd=cwd,
        env=dict(env) if env is not None else None,
        stdout=subprocess.PIPE if capture_output else None,
        stderr=subprocess.PIPE if capture_output else None,
        text=text,
        start_new_session=hasattr(os, "setsid"),
    )
    _STARTUP_CHILDREN.add(child)
    try:
        if _STARTUP_ABORTED.is_set():
            # The foreground signal handler fired between spawning and
            # registration: cancel the child right away rather than letting
            # it run to completion or timeout.
            _signal_process_group(child.pid, signal.SIGTERM)
            try:
                child.wait(timeout=5)
            except subprocess.TimeoutExpired:
                _signal_process_group(child.pid, signal.SIGKILL)
                try:
                    child.wait(timeout=5)
                except subprocess.TimeoutExpired:
                    pass
            stdout, stderr = child.communicate()
            raise LauncherError("startup step cancelled by an abort signal")
        try:
            stdout, stderr = child.communicate(timeout=timeout)
        except subprocess.TimeoutExpired:
            _signal_process_group(child.pid, signal.SIGKILL)
            child.communicate()
            raise
    finally:
        _STARTUP_CHILDREN.discard(child)
        if child.poll() is None or _STARTUP_ABORTED.is_set():
            # Escalate to SIGKILL for the whole group: descendants that ignore
            # SIGTERM must not outlive the launcher during shutdown.
            _signal_process_group(child.pid, signal.SIGKILL)
            if child.poll() is None:
                try:
                    child.wait(timeout=5)
                except subprocess.TimeoutExpired:
                    pass
    return subprocess.CompletedProcess(command, child.returncode, stdout, stderr)


@dataclass(frozen=True, slots=True)
class AppSettings:
    app_root: Path
    app_python: Path
    node: str
    build_script: Path
    typescript: Path
    runtime_root: Path
    environment: Mapping[str, str]


def build_app_settings(app_root: Path, environment: Mapping[str, str]) -> AppSettings:
    app_root = app_root.resolve()
    return AppSettings(
        app_root=app_root,
        app_python=app_root / ".venv/bin/python",
        node=NODE_EXECUTABLE,
        build_script=app_root / BUILD_SCRIPT,
        typescript=app_root / "node_modules/.bin/tsc",
        runtime_root=app_root / APP_RUNTIME_ROOT,
        environment=dict(environment),
    )


def app_environment(settings: AppSettings) -> dict[str, str]:
    environment = dict(settings.environment)
    environment.update(
        {
            "FLASK_DEBUG": "false",
            "PYTHONUNBUFFERED": "1",
            "_DISTRIBUTIONMAPAPP_DEPENDENCY_PREFLIGHT": "0",
            "_DISTRIBUTIONMAPAPP_RUNTIME_STARTUP": "1",
        }
    )
    return environment


def app_process_spec(settings: AppSettings) -> ProcessSpec:
    command = (
        str(settings.app_python),
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
    return ProcessSpec("app", command, settings.app_root, app_environment(settings))


def preflight(
    settings: AppSettings,
    *,
    runner: Callable[..., subprocess.CompletedProcess[str]] = _run_startup_step,
    port_check: Callable[[str, int], bool] = _port_is_free,
) -> None:
    _require_file(settings.app_python, "app virtual environment", executable=True)
    _require_file(settings.typescript, "local TypeScript compiler", executable=True)
    _require_file(settings.build_script, "clean frontend build driver")
    if shutil.which(settings.node) is None:
        raise LauncherError("Node.js runtime is unavailable")
    if not port_check(APP_HOST, APP_PORT):
        raise LauncherError("required loopback port is already in use")

    app_check = runner(
        [str(settings.app_python), "-m", APP_PREFLIGHT_MODULE],
        cwd=settings.app_root,
        env=dict(settings.environment),
        capture_output=True,
        text=True,
        timeout=PREFLIGHT_TIMEOUT_SECONDS,
        check=False,
    )
    if app_check.returncode != 0:
        raise LauncherError(
            "app dependencies or Earth Engine prerequisites are unavailable"
        )

    # Run in a fresh, signal-managed process before the serving Flask process
    # imports config.LOCAL_STATIONS. Keep downloader progress and warnings visible.
    stations = runner(
        [str(settings.app_python), "-m", STATION_BOOTSTRAP_MODULE],
        cwd=settings.app_root,
        env=dict(settings.environment),
        capture_output=False,
        text=True,
        timeout=None,
        check=False,
    )
    if stations.returncode != 0:
        raise LauncherError("no usable station data is available after bootstrap")

    build = runner(
        [settings.node, str(settings.build_script)],
        cwd=settings.app_root,
        env=dict(settings.environment),
        capture_output=True,
        text=True,
        timeout=BUILD_TIMEOUT_SECONDS,
        check=False,
    )
    if build.returncode != 0:
        raise LauncherError("the frontend did not build")


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(description=__doc__)
    return parser


def main(argv: Sequence[str] | None = None) -> int:
    build_parser().parse_args(argv)
    try:
        app_root = resolve_app_root()
        settings = build_app_settings(app_root, os.environ)
        with SupervisorLock(settings.runtime_root / "supervisor.lock"):
            stop = threading.Event()
            previous = {}

            def request_stop(_signum: int, _frame: object) -> None:
                stop.set()
                _terminate_startup_children()

            # Handlers are installed before preflight so the whole foreground
            # startup (dependency check, build, backend) cleans up on signal.
            for signum in (signal.SIGINT, signal.SIGTERM):
                previous[signum] = signal.signal(signum, request_stop)

            def report_started() -> None:
                print(f"App: {APP_ORIGIN}")
                print("Frontend: compiled through the clean deterministic build")
                print("Press Ctrl+C to stop the backend.")

            try:
                preflight(settings)
                returncode = supervise(
                    (app_process_spec(settings),),
                    settings.runtime_root / "logs",
                    stop_requested=stop.is_set,
                    on_started=report_started,
                )
            finally:
                for signum, handler in previous.items():
                    signal.signal(signum, handler)
            if returncode != 0:
                raise LauncherError("the supervised app exited unexpectedly")
            return 0
    except LauncherError as exc:
        print(f"Local app failed safely: {exc}.", file=sys.stderr)
        return 2
    except (OSError, subprocess.SubprocessError):
        print(
            "Local app failed safely; verify prerequisites and diagnostic logs.",
            file=sys.stderr,
        )
        return 2


if __name__ == "__main__":
    raise SystemExit(main())

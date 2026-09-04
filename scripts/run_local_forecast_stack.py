"""Run the local app, cached Forecast API, and automatic forecast worker."""

from __future__ import annotations

import argparse
import fcntl
import os
import select
import signal
import socket
import subprocess
import sys
import threading
import time
from collections.abc import Callable, Mapping, Sequence
from dataclasses import dataclass
from pathlib import Path
from typing import BinaryIO

APP_HOST = "127.0.0.1"
APP_PORT = 5000
API_HOST = "127.0.0.1"
API_PORT = 8765
APP_ORIGIN = f"http://{APP_HOST}:{APP_PORT}"
API_ORIGIN = f"http://{API_HOST}:{API_PORT}"
ROOT = Path(__file__).resolve().parent.parent
DEFAULT_MODEL_REPO = ROOT.parent / "distributionMapApp-model-research"
WORKER_MODULE = "flood_research.modeling.exogenous.operational_worker"
API_MODULE = "flood_research.forecast_api.server"
APP_PREFLIGHT_MODULE = "app_preflight"
LOG_FILE_MAX_BYTES = 1024 * 1024
LOG_FILES_PER_PROCESS = 3
LOG_READ_CHUNK_BYTES = 64 * 1024


class LauncherError(RuntimeError):
    """A sanitized local-launch contract failure."""


@dataclass(frozen=True, slots=True)
class Settings:
    app_root: Path
    model_root: Path
    app_python: Path
    model_python: Path
    typescript: Path
    model_config: Path
    model_bundle: Path
    weights: Path
    state_root: Path
    cache_path: Path
    runtime_root: Path
    environment: Mapping[str, str]


@dataclass(frozen=True, slots=True)
class ProcessSpec:
    name: str
    command: tuple[str, ...]
    cwd: Path
    environment: Mapping[str, str]


def _model_path(
    model_root: Path, value: str | None, default: Path | None = None
) -> Path:
    if value:
        candidate = Path(value).expanduser()
    elif default is not None:
        candidate = default
    else:
        raise LauncherError("required model runtime path is not configured")
    return candidate if candidate.is_absolute() else model_root / candidate


def build_settings(
    app_root: Path, model_root: Path, environment: Mapping[str, str]
) -> Settings:
    app_root = app_root.resolve()
    model_root = model_root.expanduser().resolve()
    model_config = _model_path(
        model_root,
        environment.get("BDCTB_MODEL_CONFIG"),
        Path("configs/model/bdctb_exogenous_qgb_v1.yaml"),
    )
    state_root = _model_path(
        model_root, environment.get("BDCTB_STATE_ROOT"), Path("var/operational/bdctb")
    )
    cache_path = _model_path(
        model_root,
        environment.get("BDCTB_CACHE_PATH"),
        Path("var/forecasts/bdctb/latest-v1.json"),
    )
    if cache_path.name != "latest-v1.json":
        raise LauncherError("forecast cache must use the fixed latest-v1.json filename")
    return Settings(
        app_root=app_root,
        model_root=model_root,
        app_python=app_root / ".venv/bin/python",
        model_python=model_root / ".venv/bin/python",
        typescript=app_root / "node_modules/.bin/tsc",
        model_config=model_config,
        model_bundle=_model_path(model_root, environment.get("BDCTB_MODEL_BUNDLE")),
        weights=_model_path(model_root, environment.get("BDCTB_GEFS_WEIGHTS")),
        state_root=state_root,
        cache_path=cache_path,
        runtime_root=app_root / ".cache/bdctb-local-stack",
        environment=dict(environment),
    )


def _require_file(path: Path, label: str, *, executable: bool = False) -> None:
    if not path.is_file() or (executable and not os.access(path, os.X_OK)):
        raise LauncherError(f"{label} is unavailable")


def _port_is_free(host: str, port: int) -> bool:
    try:
        with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as probe:
            probe.bind((host, port))
    except OSError:
        return False
    return True


def worker_environment(settings: Settings) -> dict[str, str]:
    environment = dict(settings.environment)
    environment.update(
        {
            "BDCTB_STATE_ROOT": str(settings.state_root),
            "BDCTB_CACHE_PATH": str(settings.cache_path),
            "BDCTB_MODEL_CONFIG": str(settings.model_config),
            "BDCTB_MODEL_BUNDLE": str(settings.model_bundle),
            "BDCTB_GEFS_WEIGHTS": str(settings.weights),
            "PYTHONUNBUFFERED": "1",
        }
    )
    return environment


def process_specs(settings: Settings) -> tuple[ProcessSpec, ...]:
    worker_env = worker_environment(settings)
    app_env = dict(settings.environment)
    app_env.update(
        {
            "BDCTB_FORECAST_API_BASE_URL": API_ORIGIN,
            "FLASK_DEBUG": "false",
            "PYTHONUNBUFFERED": "1",
            "_DISTRIBUTIONMAPAPP_DEPENDENCY_PREFLIGHT": "0",
        }
    )
    api_command = (
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
    worker_command = (str(settings.model_python), "-m", WORKER_MODULE)
    app_command = (
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
    return (
        ProcessSpec("forecast-api", api_command, settings.model_root, worker_env),
        ProcessSpec("forecast-worker", worker_command, settings.model_root, worker_env),
        ProcessSpec("app", app_command, settings.app_root, app_env),
    )


def preflight(
    settings: Settings,
    *,
    runner: Callable[..., subprocess.CompletedProcess[str]] = subprocess.run,
    port_check: Callable[[str, int], bool] = _port_is_free,
) -> None:
    if not settings.model_root.is_dir():
        raise LauncherError("model repository is unavailable")
    _require_file(settings.app_python, "app virtual environment", executable=True)
    _require_file(settings.model_python, "model virtual environment", executable=True)
    _require_file(settings.typescript, "local TypeScript compiler", executable=True)
    _require_file(settings.model_config, "model configuration")
    if not settings.model_bundle.is_dir():
        raise LauncherError("model bundle is unavailable")
    _require_file(settings.model_bundle / "manifest.json", "model bundle manifest")
    _require_file(settings.weights, "GEFS spatial weights")
    if not port_check(APP_HOST, APP_PORT) or not port_check(API_HOST, API_PORT):
        raise LauncherError("required loopback port is already in use")

    app_check = runner(
        [str(settings.app_python), "-m", APP_PREFLIGHT_MODULE],
        cwd=settings.app_root,
        env=dict(settings.environment),
        capture_output=True,
        text=True,
        timeout=30,
        check=False,
    )
    if app_check.returncode != 0:
        raise LauncherError(
            "app dependencies or Earth Engine prerequisites are unavailable"
        )

    model_check = runner(
        [str(settings.model_python), "-m", WORKER_MODULE, "--preflight"],
        cwd=settings.model_root,
        env=worker_environment(settings),
        capture_output=True,
        text=True,
        timeout=120,
        check=False,
    )
    if model_check.returncode != 0:
        raise LauncherError(
            "model dependencies, artifacts, or provider prerequisites are unavailable"
        )

    build = runner(
        [str(settings.typescript), "--pretty", "false"],
        cwd=settings.app_root,
        env=dict(settings.environment),
        capture_output=True,
        text=True,
        timeout=120,
        check=False,
    )
    if build.returncode != 0:
        raise LauncherError("the current TypeScript application did not compile")


class SupervisorLock:
    def __init__(self, path: Path) -> None:
        self.path = path
        self.stream = None

    def __enter__(self) -> SupervisorLock:
        self.path.parent.mkdir(parents=True, exist_ok=True)
        self.stream = self.path.open("a+b")
        try:
            fcntl.flock(self.stream, fcntl.LOCK_EX | fcntl.LOCK_NB)
        except BlockingIOError as exc:
            self.stream.close()
            self.stream = None
            raise LauncherError(
                "the local forecast stack is already supervised"
            ) from exc
        return self

    def __exit__(self, *_args: object) -> None:
        if self.stream is not None:
            fcntl.flock(self.stream, fcntl.LOCK_UN)
            self.stream.close()
            self.stream = None


def _terminate(children: Sequence[subprocess.Popen[bytes]]) -> None:
    for child in children:
        if child.poll() is None:
            child.terminate()
    for child in children:
        if child.poll() is None:
            try:
                child.wait(timeout=5)
            except subprocess.TimeoutExpired:
                child.kill()
                child.wait(timeout=5)


def _rotated_log_path(path: Path, index: int) -> Path:
    return path.with_name(f"{path.name}.{index}")


class _BoundedLog:
    def __init__(self, path: Path) -> None:
        self.path = path
        self.stream: BinaryIO | None = None
        self.size = 0
        self._rotate()
        self._open()

    def _open(self) -> None:
        flags = os.O_WRONLY | os.O_CREAT | os.O_EXCL | getattr(os, "O_NOFOLLOW", 0)
        descriptor = os.open(self.path, flags, 0o600)
        os.fchmod(descriptor, 0o600)
        self.stream = os.fdopen(descriptor, "wb", buffering=0)
        self.size = 0

    def _rotate(self) -> None:
        if self.stream is not None:
            self.stream.close()
            self.stream = None
        _rotated_log_path(self.path, LOG_FILES_PER_PROCESS - 1).unlink(missing_ok=True)
        for index in range(LOG_FILES_PER_PROCESS - 2, 0, -1):
            source = _rotated_log_path(self.path, index)
            if source.exists():
                os.replace(source, _rotated_log_path(self.path, index + 1))
        if self.path.exists():
            os.replace(self.path, _rotated_log_path(self.path, 1))

    def write(self, data: bytes) -> None:
        pending = memoryview(data)
        while pending:
            if self.size == LOG_FILE_MAX_BYTES:
                self._rotate()
                self._open()
            count = min(len(pending), LOG_FILE_MAX_BYTES - self.size)
            assert self.stream is not None
            written = self.stream.write(pending[:count])
            if written is None or written <= 0:
                raise OSError("bounded log write made no progress")
            self.size += written
            pending = pending[written:]

    def close(self) -> None:
        if self.stream is not None:
            self.stream.close()
            self.stream = None


def _prepare_private_log_dir(log_dir: Path, names: Sequence[str]) -> None:
    log_dir.mkdir(parents=True, exist_ok=True, mode=0o700)
    log_dir.chmod(0o700)
    retained = {
        name
        for process_name in names
        for name in (
            f"{process_name}.log",
            *(
                f"{process_name}.log.{index}"
                for index in range(1, LOG_FILES_PER_PROCESS)
            ),
        )
    }
    for path in log_dir.iterdir():
        if path.is_symlink() or (path.name not in retained and path.is_file()):
            path.unlink()
        elif path.name in retained and path.is_file():
            path.chmod(0o600)


def _pump_output(
    source: BinaryIO,
    target: _BoundedLog,
    stop_requested: threading.Event,
    failed: threading.Event,
) -> None:
    can_write = True

    def write(data: bytes) -> None:
        nonlocal can_write
        if not can_write:
            return
        try:
            target.write(data)
        except OSError:
            can_write = False
            failed.set()

    try:
        try:
            descriptor = source.fileno()
            os.set_blocking(descriptor, False)
        except (AttributeError, OSError):
            while data := source.read(LOG_READ_CHUNK_BYTES):
                write(data)
            return

        remaining_after_stop = LOG_FILE_MAX_BYTES
        while True:
            ready, _, _ = select.select([descriptor], [], [], 0.1)
            if not ready:
                if stop_requested.is_set():
                    return
                continue
            try:
                data = os.read(descriptor, LOG_READ_CHUNK_BYTES)
            except BlockingIOError:
                continue
            if not data:
                return
            write(data)
            if stop_requested.is_set():
                remaining_after_stop -= len(data)
                if remaining_after_stop <= 0:
                    return
    finally:
        source.close()
        target.close()


def supervise(
    specs: Sequence[ProcessSpec],
    log_dir: Path,
    *,
    popen: Callable[..., subprocess.Popen[bytes]] = subprocess.Popen,
    sleep: Callable[[float], None] = time.sleep,
    stop_requested: Callable[[], bool] = lambda: False,
    on_started: Callable[[], None] = lambda: None,
) -> int:
    _prepare_private_log_dir(log_dir, [spec.name for spec in specs])
    children: list[subprocess.Popen[bytes]] = []
    pump_stop = threading.Event()
    pump_failed = threading.Event()
    pumps: list[threading.Thread] = []
    try:
        for spec in specs:
            log = _BoundedLog(log_dir / f"{spec.name}.log")
            try:
                child = popen(
                    list(spec.command),
                    cwd=spec.cwd,
                    env=dict(spec.environment),
                    stdin=subprocess.DEVNULL,
                    stdout=subprocess.PIPE,
                    stderr=subprocess.STDOUT,
                )
            except BaseException:
                log.close()
                raise
            children.append(child)
            if child.stdout is None:
                log.close()
                raise LauncherError("supervised child output pipe is unavailable")
            pump = threading.Thread(
                target=_pump_output,
                args=(child.stdout, log, pump_stop, pump_failed),
                name=f"bdctb-log-pump-{spec.name}",
            )
            pump.start()
            pumps.append(pump)
            returncode = child.poll()
            if returncode is not None:
                return returncode if returncode != 0 else 1
        on_started()
        while not stop_requested():
            for child in children:
                returncode = child.poll()
                if returncode is not None:
                    return returncode if returncode != 0 else 1
            if pump_failed.is_set():
                return 1
            sleep(0.25)
        return 0
    finally:
        _terminate(children)
        pump_stop.set()
        for pump in pumps:
            pump.join()


def _parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "--model-repo",
        type=Path,
        default=DEFAULT_MODEL_REPO,
        help="Model repository path (default: existing sibling repository).",
    )
    return parser


def main(argv: Sequence[str] | None = None) -> int:
    args = _parser().parse_args(argv)
    try:
        settings = build_settings(ROOT, args.model_repo, os.environ)
        with SupervisorLock(settings.runtime_root / "supervisor.lock"):
            preflight(settings)
            settings.state_root.mkdir(parents=True, exist_ok=True)
            settings.cache_path.parent.mkdir(parents=True, exist_ok=True)
            stop = threading.Event()
            previous = {}

            def request_stop(_signum: int, _frame: object) -> None:
                stop.set()

            for signum in (signal.SIGINT, signal.SIGTERM):
                previous[signum] = signal.signal(signum, request_stop)

            def report_started() -> None:
                print(f"App: {APP_ORIGIN}")
                print(
                    f"Forecast API: {API_ORIGIN} "
                    "(HTTP 503 is expected until cache publication)"
                )
                print("Automatic worker: running independently with bounded polling")
                print("Press Ctrl+C to stop the three child processes.")

            try:
                returncode = supervise(
                    process_specs(settings),
                    settings.runtime_root / "logs",
                    stop_requested=stop.is_set,
                    on_started=report_started,
                )
            finally:
                for signum, handler in previous.items():
                    signal.signal(signum, handler)
            if returncode != 0:
                raise LauncherError("a supervised child exited unexpectedly")
            return 0
    except LauncherError as exc:
        print(f"Local stack failed safely: {exc}.", file=sys.stderr)
        return 2
    except (OSError, subprocess.SubprocessError):
        print(
            "Local stack failed safely; verify prerequisites and diagnostic logs.",
            file=sys.stderr,
        )
        return 2


if __name__ == "__main__":
    raise SystemExit(main())

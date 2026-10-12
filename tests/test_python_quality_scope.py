"""Public quality entrypoints cover relocated packages and preserve failures."""

import hashlib
import json
import os
import subprocess
import sys
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parents[1]


@pytest.mark.parametrize("name", ["lint", "format", "coverage"])
@pytest.mark.parametrize("exit_code", [0, 7])
def test_quality_scope_and_exit_contract(tmp_path, name, exit_code):
    bin_dir = tmp_path / "bin"
    bin_dir.mkdir()
    mock = (
        f"#!{sys.executable}\n"
        "import json, os, sys\n"
        "args = sys.argv[1:]\n"
        "if args[:1] == ['-c']: sys.exit(0)\n"
        "print(json.dumps(args))\n"
        "code = int(os.environ['OWNED_CHECK_EXIT'])\n"
        "if code: print('synthetic-check-failure', file=sys.stderr)\n"
        "sys.exit(code)\n"
    )
    for command in ("ruff", "python"):
        path = bin_dir / command
        path.write_text(mock, encoding="utf-8")
        path.chmod(0o755)
    marker = tmp_path / "owned.gif"
    marker.write_bytes(b"GIF89a-owned")
    before = hashlib.sha256(marker.read_bytes()).digest()
    result = subprocess.run(
        ["bash", str(ROOT / "scripts/python/quality" / f"{name}.sh")],
        cwd=ROOT,
        env={
            **os.environ,
            "PATH": str(bin_dir) + os.pathsep + os.environ["PATH"],
            "HOME": str(tmp_path),
            "TMPDIR": str(tmp_path),
            "VIRTUAL_ENV": str(tmp_path),
            "OWNED_CHECK_EXIT": str(exit_code),
        },
        capture_output=True,
        text=True,
        timeout=10,
    )
    args = json.loads(
        next(line for line in result.stdout.splitlines() if line.startswith("["))
    )
    if name == "coverage":
        assert args == [
            "-m",
            "pytest",
            "--cov=app",
            "--cov=routes",
            "--cov=backend",
            "--cov=config",
            "--cov=extensions",
            "--cov-report=term-missing",
            "--cov-report=html:htmlcov",
            "--ignore=tests/integration",
            "tests/",
        ]
        assert "Packages: app, routes, backend, config, extensions\n" in result.stdout
        assert "Coverage report complete" in result.stdout
    else:
        flags = ["check"] if name == "lint" else ["format", "--check"]
        assert args == flags + [
            "app.py",
            "routes/",
            "backend/",
            "config.py",
            "extensions.py",
        ]
        assert (
            "Scope: app/, routes/, backend/, config.py, extensions.py\n"
            in result.stdout
        )
        assert ("check complete" in result.stdout) is (exit_code == 0)
    if name == "coverage":
        heading = (
            "Running Python test coverage...\n"
            "Packages: app, routes, backend, config, extensions\n"
            "Scope: Unit tests only (excludes integration tests with external deps)\n\n"
        )
        ending = (
            "\nCoverage report complete "
            "(informational only - no threshold enforcement)\n"
            "Note: First-pass scope excludes integration tests "
            "with external dependencies\n"
        )
    else:
        heading = (
            f"Running Python {name} check with Ruff...\n"
            "Scope: app/, routes/, backend/, config.py, extensions.py\n\n"
        )
        completion = (
            "Lint check complete"
            if name == "lint"
            else "Format check complete - no formatting changes needed"
        )
        ending = f"\n{completion}\n" if exit_code == 0 else ""
    assert result.stdout == heading + json.dumps(args) + "\n" + ending
    assert result.returncode == exit_code
    assert result.stderr == ("synthetic-check-failure\n" if exit_code else "")
    assert hashlib.sha256(marker.read_bytes()).digest() == before
    assert sorted(path.name for path in tmp_path.iterdir()) == ["bin", "owned.gif"]

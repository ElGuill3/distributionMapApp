"""Contract tests for the clean deterministic TypeScript build driver."""

import json
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]


def test_typescript_build_uses_the_clean_build_driver() -> None:
    build_script = (ROOT / "scripts" / "build-typescript.mjs").read_text()

    assert "cleanGeneratedOutput(outputRoot)" in build_script
    assert "compileTypeScript()" in build_script
    clean_index = build_script.index("await cleanGeneratedOutput(outputRoot)")
    compile_index = build_script.index("await compileTypeScript()")
    assert clean_index < compile_index


def test_npm_build_script_invokes_the_clean_driver() -> None:
    package = json.loads((ROOT / "package.json").read_text(encoding="utf-8"))

    assert package["scripts"]["build:ts"] == "node scripts/build-typescript.mjs"

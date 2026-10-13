"""The line-ending maintenance script targets the moved frontend template."""

import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]


def test_convert_lf_rewrites_frontend_template_line_endings(tmp_path):
    template = tmp_path / "frontend/templates/index.html"
    template.parent.mkdir(parents=True)
    template.write_bytes(b"<html>\r\n<body></body>\r\n</html>\r\n")

    result = subprocess.run(
        [sys.executable, "-I", str(ROOT / "backend/scripts/convert_lf.py")],
        cwd=tmp_path,
        capture_output=True,
        text=True,
        timeout=20,
    )

    assert result.returncode == 0
    assert result.stdout == "Converting frontend/templates/index.html...\n"
    assert result.stderr == ""
    assert template.read_bytes() == b"<html>\n<body></body>\n</html>\n"
    assert not (tmp_path / "templates").exists()

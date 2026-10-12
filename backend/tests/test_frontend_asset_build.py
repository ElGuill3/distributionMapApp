"""Exercise the public build driver using an isolated synthetic checkout."""

import json
import subprocess
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]


def test_public_stylesheet_url_retains_exact_bytes_and_mime_type(tmp_path, monkeypatch):
    from app import app

    css = (ROOT / "frontend/src/styles/styles.css").read_bytes()
    (tmp_path / "styles.css").write_bytes(css)
    monkeypatch.setattr(app, "static_folder", str(tmp_path))
    with app.test_client() as client:
        response = client.get("/static/styles.css?v=1.0.1")
        assert response.status_code == 200
        assert response.data == css
        assert response.mimetype == "text/css"
        missing = client.get("/static/missing-styles.css")
        assert missing.status_code == 404
    assert (tmp_path / "styles.css").read_bytes() == css


def test_build_publishes_authored_styles_and_preserves_runtime_assets(tmp_path):
    for folder in (
        "scripts",
        "frontend/src/ts",
        "frontend/src/styles",
        "static/vendor",
        "static/gifs",
    ):
        (tmp_path / folder).mkdir(parents=True, exist_ok=True)
    (tmp_path / "scripts/build-typescript.mjs").write_bytes(
        (ROOT / "scripts/build-typescript.mjs").read_bytes()
    )
    (tmp_path / "node_modules").symlink_to(
        ROOT / "node_modules", target_is_directory=True
    )
    (tmp_path / "tsconfig.json").write_text(
        json.dumps(
            {
                "compilerOptions": {
                    "target": "ES2020",
                    "module": "ES2020",
                    "rootDir": "frontend/src/ts",
                    "outDir": "static",
                    "types": [],
                    "skipLibCheck": True,
                },
                "include": ["frontend/src/ts/**/*.ts"],
            }
        )
    )
    (tmp_path / "frontend/src/ts/main.ts").write_text("export const proof = 42;\n")
    css = b"/* synthetic authored stylesheet */\nbody { color: teal; }\n"
    (tmp_path / "frontend/src/styles/styles.css").write_bytes(css)
    (tmp_path / "static/styles.css").write_bytes(b"stale stylesheet")
    preserved = {
        "static/vendor/icons.mjs": b"export const icon = 1;\n",
        "static/gifs/owned.gif": b"GIF89a-owned-sentinel",
    }
    for name, content in preserved.items():
        (tmp_path / name).write_bytes(content)
    (tmp_path / "static/obsolete.js").write_bytes(b"stale generated code")
    result = subprocess.run(
        ["node", "scripts/build-typescript.mjs"],
        cwd=tmp_path,
        capture_output=True,
        text=True,
        timeout=20,
    )
    assert result.returncode == 0, result.stderr
    assert result.stdout == ""
    assert result.stderr == ""
    assert (tmp_path / "static/styles.css").read_bytes() == css
    assert "export const proof = 42;" in (tmp_path / "static/main.js").read_text()
    assert not (tmp_path / "static/obsolete.js").exists()
    for name, content in preserved.items():
        assert (tmp_path / name).read_bytes() == content
    again = subprocess.run(
        ["node", "scripts/build-typescript.mjs"],
        cwd=tmp_path,
        capture_output=True,
        text=True,
        timeout=20,
    )
    assert again.returncode == 0, again.stderr
    assert again.stdout == again.stderr == ""
    assert (tmp_path / "static/styles.css").read_bytes() == css
    for name, content in preserved.items():
        assert (tmp_path / name).read_bytes() == content

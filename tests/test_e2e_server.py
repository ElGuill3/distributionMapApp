"""Public HTTP and CLI contracts for the provider-free E2E server."""

import os
import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
PROBE = """
import importlib.util, json, re, sys
from pathlib import Path
server_path = Path(sys.argv[1])
spec = importlib.util.spec_from_file_location('e2e_server', server_path)
module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)
app = module.create_e2e_app()
with app.test_client() as client:
    root = client.get('/')
    legacy = client.get('/templates/index.html')
    assert root.status_code == legacy.status_code == 200
    assert root.data == legacy.data
    pattern = r'<script id="runtime-limits" type="application/json">(.*?)</script>'
    match = re.search(pattern, root.get_data(as_text=True), re.S)
    assert match is not None
    limits = json.loads(match.group(1))
    assert limits == {
        'MAX_SPAN_DEG': 2.5, 'MAX_YEARS_RANGE': 3.0, 'MAX_SPAN_DEG_S2': 1.5}
    for method, url in [('get', '/api/local-stations'), ('get', '/api/flood-stats'),
                        ('post', '/api/export/bundle')]:
        response = getattr(client, method)(url)
        assert response.status_code == 503
        assert response.get_json() == {
            'error': 'Synthetic E2E server: mock API requests in the browser.'}
    css = client.get('/static/styles.css?v=1.0.1')
    assert css.status_code == 200 and css.mimetype == 'text/css'
    css_source = server_path.parents[3] / 'frontend/src/styles/styles.css'
    assert css.data == css_source.read_bytes()
assert 'ee' not in sys.modules
assert 'app' not in sys.modules
assert not [
    name
    for name in sys.modules
    if name == "services" or name.startswith(("services.", "backend.services"))
]
print(json.dumps({'status': 'PASS', 'limits': limits}, sort_keys=True))
"""


def test_e2e_server_renders_limits_and_never_invokes_api_providers(tmp_path):
    sentinel = tmp_path / "owned.gif"
    sentinel.write_bytes(b"GIF89a-owned")
    env = dict(
        os.environ,
        BASE_DIR_OVERRIDE=str(tmp_path),
        MAX_SPAN_DEG="2.5",
        MAX_YEARS_RANGE="3",
        MAX_SPAN_DEG_S2="1.5",
    )
    result = subprocess.run(
        [sys.executable, "-c", PROBE, str(ROOT / "frontend/tests/e2e/server.py")],
        cwd=tmp_path,
        env=env,
        capture_output=True,
        text=True,
        timeout=20,
    )
    assert result.returncode == 0, result.stderr
    assert result.stderr == ""
    assert result.stdout == (
        '{"limits": {"MAX_SPAN_DEG": 2.5, "MAX_SPAN_DEG_S2": 1.5, '
        '"MAX_YEARS_RANGE": 3.0}, "status": "PASS"}\n'
    )
    assert sentinel.read_bytes() == b"GIF89a-owned"
    assert list(tmp_path.iterdir()) == [sentinel]


def test_e2e_server_cli_documents_loopback_port():
    result = subprocess.run(
        [sys.executable, "frontend/tests/e2e/server.py", "--help"],
        cwd=ROOT,
        capture_output=True,
        text=True,
        timeout=20,
    )
    assert result.returncode == 0
    assert result.stderr == ""
    assert result.stdout == (
        "usage: server.py [-h] [--port PORT]\n\n"
        "Render the real frontend template without importing application providers.\n\n"
        "options:\n"
        "  -h, --help   show this help message and exit\n"
        "  --port PORT  Loopback port (default: 8080).\n"
    )

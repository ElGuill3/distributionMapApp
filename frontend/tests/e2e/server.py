"""Render the real frontend template without importing application providers."""

import argparse
import json
import logging
import os
import subprocess
import sys
from pathlib import Path

from flask import Flask, Response, abort, jsonify, render_template, send_from_directory

ROOT = Path(__file__).resolve().parents[3]
sys.path.insert(0, str(ROOT))

from backend import config  # noqa: E402


def create_e2e_app():
    app = Flask(
        __name__,
        static_folder=str(ROOT / "frontend" / "static"),
        static_url_path="/e2e-unused-static",
        template_folder=str(ROOT / "frontend" / "templates"),
    )

    # Compile once in memory: current source, normal compiler options, no output
    # files or per-request transpilation delays that could race UI listeners.
    script = """
        import ts from 'typescript'; import path from 'node:path';
        import {readStyleBundle} from './frontend/scripts/bundle-styles.mjs';
        const config = ts.readConfigFile('tsconfig.json', ts.sys.readFile);
        const parsed = ts.parseJsonConfigFileContent(config.config, ts.sys, process.cwd());
        const assets = {'styles.css': readStyleBundle().css};
        const program = ts.createProgram(parsed.fileNames, {...parsed.options, sourceMap: false});
        program.emit(undefined, (file, text) => {
            assets[path.relative('frontend/static', file)] = text;
        });
        process.stdout.write(JSON.stringify(assets));
    """
    result = subprocess.run(
        ["node", "--input-type=module", "-e", script],
        cwd=ROOT, capture_output=True, check=True, timeout=15,
    )
    assets = json.loads(result.stdout)

    @app.get("/static/<path:asset>")
    def current_frontend(asset):
        if asset in assets:
            mime = "text/css" if asset.endswith(".css") else "text/javascript"
            return Response(assets[asset], mimetype=mime)
        return send_from_directory(app.static_folder, asset)

    @app.after_request
    def restrict_external_access(response):
        # Apply to every existing spec too: only library CDNs may use the network.
        response.headers["Content-Security-Policy"] = (
            "default-src 'self' data: blob:; "
            "script-src 'self' 'unsafe-inline' 'unsafe-eval' https://unpkg.com https://cdn.plot.ly https://cdn.jsdelivr.net; "
            "style-src 'self' 'unsafe-inline' https://unpkg.com; "
            "connect-src 'self' https://cdn.jsdelivr.net; "
            "img-src 'self' data: blob: "
            + ("https://*.tile.openstreetmap.org " if os.environ.get("E2E_SCREENSHOT_TILES") == "1" else "")
            + "; "
            +
            "worker-src 'self' blob:"
        )
        return response

    @app.get("/")
    @app.get("/templates/index.html")
    def index():
        return render_template(
            "index.html",
            runtime_limits={
                "MAX_SPAN_DEG": config.MAX_SPAN_DEG,
                "MAX_YEARS_RANGE": config.MAX_YEARS_RANGE,
                "MAX_SPAN_DEG_S2": config.MAX_SPAN_DEG_S2,
            },
        )

    # The published flood susceptibility map is static data: serve the real
    # files so the browser exercises the actual tiles and statistics.
    flood_dir = Path(config.FLOOD_RISK_DIR)

    @app.get("/api/flood-risk/metadata")
    def flood_risk_metadata():
        metadata = json.loads((flood_dir / "metadata.json").read_text("utf-8"))
        metadata["tiles"]["url"] = "/api/flood-risk/" + metadata["tiles"]["url"]
        return jsonify(metadata)

    @app.get("/api/flood-risk/municipalities")
    def flood_risk_municipalities():
        return send_from_directory(flood_dir, "municipalities.geojson")

    @app.get("/api/flood-risk/tiles/<int:z>/<int:x>/<int:y>.png")
    def flood_risk_tile(z, x, y):
        if not (flood_dir / "tiles" / str(z) / str(x) / f"{y}.png").is_file():
            abort(404)
        return send_from_directory(flood_dir / "tiles", f"{z}/{x}/{y}.png")

    @app.route("/api/<path:unused>", methods=["GET", "POST"])
    def unavailable_api(unused):
        return jsonify(
            error="Synthetic E2E server: mock API requests in the browser."
        ), 503

    return app


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "--port", type=int, default=8080, help="Loopback port (default: 8080)."
    )
    args = parser.parse_args()
    logging.getLogger("werkzeug").setLevel(logging.ERROR)
    create_e2e_app().run(host="127.0.0.1", port=args.port, use_reloader=False)

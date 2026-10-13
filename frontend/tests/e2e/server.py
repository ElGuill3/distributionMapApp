"""Render the real frontend template without importing application providers."""

import argparse
import json
import sys
from pathlib import Path

from flask import Flask, abort, jsonify, render_template, send_from_directory

ROOT = Path(__file__).resolve().parents[3]
sys.path.insert(0, str(ROOT))

from backend import config  # noqa: E402


def create_e2e_app():
    app = Flask(
        __name__,
        static_folder=str(ROOT / "frontend" / "static"),
        template_folder=str(ROOT / "frontend" / "templates"),
    )

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
    create_e2e_app().run(host="127.0.0.1", port=args.port, use_reloader=False)

"""Public blueprint ownership at the canonical backend.routes package boundary."""

import backend.app as app_module
from backend.routes.export_routes import export_bp
from backend.routes.flood_routes import flood_bp
from backend.routes.gif_routes import gif_bp
from backend.routes.progress_routes import progress_bp
from backend.routes.station_routes import station_bp
from backend.routes.timeseries_routes import ts_bp

CANONICAL_BLUEPRINTS = (export_bp, flood_bp, gif_bp, progress_bp, station_bp, ts_bp)

EXPECTED_URL_RULES = frozenset(
    {
        "/",
        "/api/docs",
        "/api/docs/openapi.yaml",
        "/api/era5-soil-gif-bbox",
        "/api/era5-soil-timeseries-bbox",
        "/api/era5-temp-gif-bbox",
        "/api/era5-temp-timeseries-bbox",
        "/api/export/bundle",
        "/api/flood-detection",
        "/api/flood-risk-municipio",
        "/api/flood-stats",
        "/api/gif-progress/<task_id>",
        "/api/imerg-precip-gif-bbox",
        "/api/imerg-precip-timeseries-bbox",
        "/api/local-station-level-range",
        "/api/local-stations",
        "/api/ndvi-gif-bbox",
        "/api/ndvi-timeseries-bbox",
        "/api/v1/forecasts/bdctb",
        "/static/<path:filename>",
    }
)


def test_app_registry_owns_canonical_backend_route_blueprints():
    for blueprint in CANONICAL_BLUEPRINTS:
        assert app_module.app.blueprints[blueprint.name] is blueprint


def test_public_url_inventory_is_unchanged():
    rules = {str(rule) for rule in app_module.app.url_map.iter_rules()}
    assert rules == EXPECTED_URL_RULES

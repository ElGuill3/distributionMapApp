"""
test_api_docs.py — Integration tests for the OpenAPI documentation endpoints.

Tests:
  - /api/docs serves an HTML page (Scalar UI)
  - /api/docs/openapi.yaml serves a valid YAML file
  - The YAML is a valid OpenAPI 3.1 document (passes openapi-spec-validator)
  - The generate_schemas.py output matches the committed components/schemas block
"""

import subprocess
import sys
from pathlib import Path

import pytest
import yaml

ROOT = Path(__file__).parent.parent
OPENAPI_YAML = ROOT / "openapi.yaml"
GENERATE_SCRIPT = ROOT / "scripts" / "generate_schemas.py"


class TestApiDocsServe:
    """Tests for /api/docs and /api/docs/openapi.yaml routes."""

    @pytest.fixture
    def client(self):
        """Flask test client using the real app."""
        # Import only after mock_modules has run
        from app import app as flask_app

        flask_app.config["TESTING"] = True
        with flask_app.test_client() as client:
            yield client

    def test_api_docs_returns_html(self, client):
        """GET /api/docs returns 200 with text/html content."""
        response = client.get("/api/docs")
        assert response.status_code == 200
        assert response.content_type == "text/html; charset=utf-8"
        # Scalar loads via CDN, so the HTML should contain the reference div
        assert b"api-reference" in response.data

    def test_api_docs_openapi_yaml_returns_yaml(self, client):
        """GET /api/docs/openapi.yaml returns 200 with application/yaml content."""
        response = client.get("/api/docs/openapi.yaml")
        assert response.status_code == 200
        assert response.content_type == "application/yaml"
        # Should be parseable as YAML
        data = yaml.safe_load(response.data)
        assert isinstance(data, dict)


class TestOpenApiSpec:
    """Tests for the openapi.yaml content validity."""

    def test_openapi_yaml_is_valid_openapi_30(self):
        """The spec passes openapi-spec-validator without errors."""
        try:
            from openapi_spec_validator import validate  # noqa: F401
        except ImportError:
            pytest.skip("openapi-spec-validator not installed")

        with open(OPENAPI_YAML) as f:
            spec = yaml.safe_load(f)
        validate(spec)

    def test_openapi_yaml_has_info(self):
        """The spec has required info object (title, version)."""
        with open(OPENAPI_YAML) as f:
            spec = yaml.safe_load(f)
        assert "info" in spec
        assert "title" in spec["info"]
        assert "version" in spec["info"]

    def test_openapi_yaml_has_14_paths(self):
        """The spec documents exactly 14 endpoints."""
        with open(OPENAPI_YAML) as f:
            spec = yaml.safe_load(f)
        paths = spec.get("paths", {})
        assert len(paths) == 14, f"Expected 14 paths, got {len(paths)}: {list(paths.keys())}"

    def test_openapi_yaml_has_components_schemas(self):
        """The spec has component schemas including ErrorResponse."""
        with open(OPENAPI_YAML) as f:
            spec = yaml.safe_load(f)
        schemas = spec.get("components", {}).get("schemas", {})
        assert "ErrorResponse" in schemas
        assert "BBoxSchema" in schemas
        assert "MuniQuerySchema" in schemas


class TestSchemaDrift:
    """Tests to ensure schemas generated from Pydantic stay in sync with openapi.yaml."""

    def test_generate_schemas_matches_committed(self):
        """
        Running generate_schemas.py produces output identical to the
        components/schemas already committed in openapi.yaml.

        This is a drift check: if someone modifies a Pydantic schema and
        regenerates but forgets to commit the result, this test catches it.
        """
        result = subprocess.run(
            [sys.executable, str(GENERATE_SCRIPT)],
            capture_output=True,
            text=True,
            cwd=str(ROOT),
        )
        assert result.returncode == 0, f"generate_schemas.py failed: {result.stderr}"

        generated = yaml.safe_load(result.stdout)
        # Script outputs {"schemas": {...}}, flatten to just the dict
        if isinstance(generated, dict) and "schemas" in generated:
            generated = generated["schemas"]

        with open(OPENAPI_YAML) as f:
            spec = yaml.safe_load(f)

        committed = spec.get("components", {}).get("schemas", {})

        # Compare just the schemas that generate_schemas.py is expected to generate
        # (BBoxSchema, DateRangeSchema, StationQuerySchema, MuniQuerySchema,
        #  ExportRequestSchema, SeriesDataSchema, ExportMetadataSchema)
        expected_keys = [
            "BBoxSchema",
            "DateRangeSchema",
            "StationQuerySchema",
            "MuniQuerySchema",
            "ExportRequestSchema",
            "SeriesDataSchema",
            "ExportMetadataSchema",
        ]

        for key in expected_keys:
            assert key in committed, f"{key} missing from committed schemas"
            assert key in generated, f"{key} missing from generated schemas"
            assert (
                committed[key] == generated[key]
            ), f"{key} schema drifted — run scripts/generate_schemas.py --merge and commit"

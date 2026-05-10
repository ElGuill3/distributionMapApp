#!/usr/bin/env python3
"""
Generate OpenAPI 3.1 component schemas from Pydantic v2 models.

Usage:
    python scripts/generate_schemas.py           # print to stdout
    python scripts/generate_schemas.py --merge    # merge into openapi.yaml

This script imports the 5 Pydantic validation schemas used by the API,
calls model_json_schema() on each, and outputs a YAML fragment suitable
for embedding under openapi.yaml > components > schemas.

When run with --merge, it reads openapi.yaml, replaces the
components.schemas section with the generated output (preserving
manually-maintained schemas like ErrorResponse), and writes back.
"""

import sys
import yaml

# Ensure project root is on sys.path so we can import gee.schemas
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from gee.schemas import (
    BBoxSchema,
    DateRangeSchema,
    StationQuerySchema,
    MuniQuerySchema,
    ExportRequestSchema,
)

SCHEMA_MODELS = [
    ("BBoxSchema", BBoxSchema),
    ("DateRangeSchema", DateRangeSchema),
    ("StationQuerySchema", StationQuerySchema),
    ("MuniQuerySchema", MuniQuerySchema),
    ("ExportRequestSchema", ExportRequestSchema),
]


def _normalize_refs(schema: dict) -> None:
    """
    Mutate schema in-place: replace all '#/$defs/X' references with
    '#/components/schemas/X'.  This is applied recursively so that any
    sub-schema reachable from the top-level schema gets normalised.
    """
    import copy

    def walk(node):
        if isinstance(node, dict):
            if "$ref" in node and isinstance(node["$ref"], str) and node["$ref"].startswith("#/$defs/"):
                node["$ref"] = node["$ref"].replace("#/$defs/", "#/components/schemas/")
            for value in node.values():
                walk(value)
        elif isinstance(node, list):
            for item in node:
                walk(item)

    walk(schema)


def generate_schemas() -> tuple[dict, dict]:
    """Generate component schemas dict from Pydantic models.

    Returns:
        (schemas, all_defs) where schemas is the top-level dict keyed by model name
        and all_defs collects all $defs from all models for promotion.
    """
    all_defs = {}

    for name, model in SCHEMA_MODELS:
        raw = model.model_json_schema()
        defs = raw.pop("$defs", {})
        for def_name, def_schema in defs.items():
            all_defs[def_name] = def_schema

    # Normalise all $defs refs in-place, then promote as top-level schemas
    for def_schema in all_defs.values():
        _normalize_refs(def_schema)

    schemas = {}
    for name, model in SCHEMA_MODELS:
        raw = model.model_json_schema()
        defs = raw.pop("$defs", {})
        for def_name, def_schema in defs.items():
            all_defs[def_name] = def_schema
        schemas[name] = raw

    # Now all schemas are stored; normalise refs in top-level schemas too
    for schema in schemas.values():
        _normalize_refs(schema)

    # Add sub-schemas (SeriesDataSchema, ExportMetadataSchema, etc.) as
    # top-level components so that #/components/schemas/X resolves.
    for def_name, def_schema in all_defs.items():
        if def_name not in schemas:
            schemas[def_name] = def_schema

    return schemas, all_defs


def merge_into_openapi(openapi_path: Path) -> None:
    """Merge generated schemas into openapi.yaml, preserving manual schemas."""
    with open(openapi_path, "r") as f:
        spec = yaml.safe_load(f)

    generated, _ = generate_schemas()

    # Preserve manually-maintained schemas (like ErrorResponse)
    existing = spec.setdefault("components", {}).setdefault("schemas", {})
    manual_schemas = {k: v for k, v in existing.items() if k not in generated}

    # Merge: generated override existing, manual are kept
    existing.clear()
    existing.update(generated)
    existing.update(manual_schemas)

    with open(openapi_path, "w") as f:
        yaml.dump(spec, f, default_flow_style=False, sort_keys=False, allow_unicode=True)

    print(f"Merged schemas into {openapi_path}")


def main():
    if "--merge" in sys.argv:
        openapi_path = Path(__file__).resolve().parent.parent / "openapi.yaml"
        if not openapi_path.exists():
            print(f"Error: {openapi_path} not found. Create it first.", file=sys.stderr)
            sys.exit(1)
        merge_into_openapi(openapi_path)
    else:
        schemas, _ = generate_schemas()
        print(yaml.dump({"schemas": schemas}, default_flow_style=False, sort_keys=False, allow_unicode=True))


if __name__ == "__main__":
    main()
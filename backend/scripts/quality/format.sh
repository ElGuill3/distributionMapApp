#!/bin/bash
# Python format check script - runs Ruff format --check on authored source only
# Excludes: frontend/static/, backend/scripts/, backend/tests/ (as configured in ruff.toml)
# Non-zero exit if reformatting needed

set -e

echo "Running Python format check with Ruff..."
echo "Scope: backend/"
echo ""

ruff format --check backend/

echo ""
echo "Format check complete - no formatting changes needed"

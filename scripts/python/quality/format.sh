#!/bin/bash
# Python format check script - runs Ruff format --check on authored source only
# Excludes: static/, scripts/, tests/ (as configured in ruff.toml)
# Non-zero exit if reformatting needed

set -e

echo "Running Python format check with Ruff..."
echo "Scope: app/, routes/, services/, gee/, config.py, extensions.py"
echo ""

ruff format --check app.py routes/ services/ gee/ config.py extensions.py

echo ""
echo "Format check complete - no formatting changes needed"

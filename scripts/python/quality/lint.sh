#!/bin/bash
# Python lint script - runs Ruff check on authored source only
# Excludes: static/, scripts/, tests/ (as configured in ruff.toml)

set -e

echo "Running Python lint check with Ruff..."
echo "Scope: app/, routes/, backend/, config.py, extensions.py"
echo ""

ruff check app.py routes/ backend/ config.py extensions.py

echo ""
echo "Lint check complete"

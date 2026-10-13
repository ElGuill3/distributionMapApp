#!/bin/bash
# Python lint script - runs Ruff check on authored source only
# Excludes: frontend/static/, backend/scripts/, backend/tests/ (as configured in ruff.toml)

set -e

echo "Running Python lint check with Ruff..."
echo "Scope: backend/"
echo ""

ruff check backend/

echo ""
echo "Lint check complete"

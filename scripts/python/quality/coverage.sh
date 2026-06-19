#!/bin/bash
# Python coverage script - reports test coverage for authored source only
# Excludes: static/, scripts/, tests/
# First-pass scope: unit tests only (excludes integration tests with environment-specific deps)
# Compliant with repo development setup: requires requirements.txt deps to be installed

set -e

echo "Running Python test coverage..."
echo "Packages: app, routes, services, gee, config, extensions"
echo "Scope: Unit tests only (excludes integration tests with external deps)"
echo ""

# Check if we are running within an active virtual environment
if [ -z "$VIRTUAL_ENV" ] && [ -z "$CONDA_DEFAULT_ENV" ]; then
    echo "WARNING: No active virtual environment detected."
    echo "Run this script using uv:"
    echo "  uv run scripts/python/quality/coverage.sh"
    echo ""
fi

# Check if required runtime dependencies are available
# These are the minimal deps needed for pytest collection to work
MISSING_DEPS=""

if ! python -c "import flask" 2>/dev/null; then
    MISSING_DEPS="$MISSING_DEPS Flask"
fi

if ! python -c "import pydantic" 2>/dev/null; then
    MISSING_DEPS="$MISSING_DEPS pydantic"
fi

if ! python -c "import flask_limiter" 2>/dev/null; then
    MISSING_DEPS="$MISSING_DEPS Flask-Limiter"
fi

if [ -n "$MISSING_DEPS" ]; then
    echo "WARNING: Missing required dependencies:$MISSING_DEPS"
    echo "Install all runtime dependencies with: uv sync"
    echo ""
    echo "Coverage check requires runtime dependencies to import and collect tests."
    echo ""
    exit 1
fi

# Don't use set -e during pytest run - we want coverage even if tests fail
set +e

# Run coverage - capture exit code but don't fail immediately
# Use 'python -m pytest' to ensure we use the same interpreter as the dependency checks
# This avoids mismatches when pytest is installed in a different environment
# 
# First-pass scope: unit tests only (--ignore=tests/integration)
# This aligns with the first-pass guardrail spec which excludes complex environment setup
python -m pytest --cov=app \
       --cov=routes \
       --cov=services \
       --cov=gee \
       --cov=config \
       --cov=extensions \
       --cov-report=term-missing \
       --cov-report=html:htmlcov \
       --ignore=tests/integration \
       tests/

PYTEST_EXIT=$?

echo ""
echo "Coverage report complete (informational only - no threshold enforcement)"
echo "Note: First-pass scope excludes integration tests with external dependencies"

# Exit with pytest's exit code (0 = all passed, 1 = some tests failed but coverage generated)
exit $PYTEST_EXIT

# Stage 1: Base Python environment with requirements
FROM python:3.11-slim AS base

WORKDIR /app

# Instalar dependencias del sistema necesarias para WeasyPrint y compilación
RUN apt-get update && apt-get install -y --no-install-recommends \
    build-essential \
    libcairo2 \
    libpango-1.0-0 \
    libpangocairo-1.0-0 \
    libgdk-pixbuf-2.0-0 \
    shared-mime-info \
    && rm -rf /var/lib/apt/lists/*

# Instalar uv desde la imagen oficial
COPY --from=ghcr.io/astral-sh/uv:latest /uv /uvx /bin/

# Copiar archivos de dependencias e instalar primero
COPY pyproject.toml uv.lock ./
RUN uv sync --frozen --no-install-project --no-dev

COPY . .

# Usar el virtualenv creado por uv
ENV PATH="/app/.venv/bin:$PATH"

# Stage 2: Web (Flask application)
FROM base AS web
EXPOSE 5000
ENV FLASK_APP=app.py
CMD ["flask", "run", "--host=0.0.0.0", "--port=5000"]

# Stage 3: Scraper (APScheduler Daemon)
FROM base AS scraper
CMD ["python", "-m", "scrapers.runner"]


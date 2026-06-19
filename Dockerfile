# Stage 1: Base Python environment with requirements
FROM python:3.11-slim AS base

WORKDIR /app

# Instalar dependencias del sistema necesarias para compilar librerías si se requiere
RUN apt-get update && apt-get install -y --no-install-recommends \
    build-essential \
    && rm -rf /var/lib/apt-cache /var/lib/apt/lists/*

COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

COPY . .

# Stage 2: Web (Flask application)
FROM base AS web
EXPOSE 5000
ENV FLASK_APP=app.py
CMD ["flask", "run", "--host=0.0.0.0", "--port=5000"]

# Stage 3: Scraper (APScheduler Daemon)
FROM base AS scraper
CMD ["python", "-m", "scrapers.runner"]

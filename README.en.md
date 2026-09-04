# Hydrometeorological Viewer — distributionMapApp

*Leer esto en [Español](README.md).*

Interactive web application to visualize animations and time series of hydrometeorological variables over the state of Tabasco, Mexico, using Google Earth Engine as the main satellite data source.

## Local quick path with automatic forecasting

From this repository root, run exactly:

```bash
.venv/bin/python scripts/run_local_forecast_stack.py
```

The command uses only the existing local environments and expects the model
repository at `../distributionMapApp-model-research`. Add
`--model-repo /path/to/repository` when it is elsewhere. The supervisor never
installs dependencies or modifies credentials. It discovers the versioned
canonical calibrated-v1 bundle and GEFS weights from the selected model
repository.

For a nonstandard layout, `BDCTB_MODEL_BUNDLE` and `BDCTB_GEFS_WEIGHTS` remain
optional explicit overrides. `BDCTB_MODEL_CONFIG`, `BDCTB_STATE_ROOT`, and
`BDCTB_CACHE_PATH` may also be overridden. Export overrides in the launcher
process; this app's `.env` is not a launcher configuration source.

Prepare these prerequisites first:

- This app's existing `.venv/` and `node_modules/`; the supervisor performs no
  installation.
- The model repository's existing `.venv/` with model, GEFS, and GloFAS
  dependencies.
- `GEE_PROJECT` and one existing local Earth Engine authorization source:
  persistent Earth Engine credentials (normally
  `~/.config/earthengine/credentials`), a credential file selected by
  `GOOGLE_APPLICATION_CREDENTIALS`, or gcloud Application Default Credentials
  (normally `~/.config/gcloud/application_default_credentials.json`).
- One external GloFAS/EWDS credential configuration: `CDSAPI_RC` pointing to a
  credentials file (or the default `~/.cdsapirc`), or both `CDSAPI_URL` and
  `CDSAPI_KEY` in the launcher environment.

The supervisor first validates these prerequisites and compiles the current
TypeScript application. It then starts three foreground processes: the app at
`http://127.0.0.1:5000`, the Forecast API at
`http://127.0.0.1:8765`, and the independent automatic worker. It configures
the app proxy to that API internally. Press `Ctrl+C` to stop only those three
children; diagnostic logs remain under `.cache/bdctb-local-stack/logs/`.
Each child retains at most three private `0600` log files of at most 1 MiB each;
the log directory is private (`0700`) and the current file retains the latest
diagnostic tail.

After `Ctrl+C`, optional cleanup is limited to supervisor diagnostics:

```bash
rm -rf .cache/bdctb-local-stack
```

Do **not** include the model's `var/operational/bdctb/` state or
`var/forecasts/bdctb/latest-v1.json` cache in routine cleanup. The state protects
submission recovery and the cache serves the last valid forecast; deleting
either intentionally resets those guarantees and can restore HTTP 503.

The browser and proxy only read the cache; they never execute the worker. The
worker ordinarily checks readiness every 15 minutes and retains its bounded
common-00Z issue, stable-GEFS, exact GloFAS-cost-at-or-below-6, and single-
submission-without-automatic-resubmission policies. On first start, HTTP 503 is
normal until a valid cache exists. If startup fails early, verify paths,
environments, Earth Engine authorization, provider credentials, and loopback
ports 5000/8765. Secret values are never printed.

Docker, systemd, host users, provisioning, and installation are explicitly out
of scope for this local workflow.

---

## Overview

The state of Tabasco presents high hydrological and climatic variability, which generates the need for tools to explore and compare environmental data visually without requiring programming knowledge. This application solves that problem by offering a cartographic viewer in the browser from which anyone can:

- Select a region of interest by drawing a box on the map.
- Choose a hydrometeorological variable, a year, and a season.
- Automatically generate a satellite animation (GIF) and its associated time-series plot.
- Compare two different periods in parallel using the **comparison mode**.
- Visualize the flood risk map by municipality.
- Query the hydrometric levels of local stations: San Pedro (SPTTB) and Boca del Cerro (BDCTB).

**Default study area:** state of Tabasco (approximate center: 17.84° N, 92.62° W, initial zoom 8).

---

## Key Features

### Satellite Variables (Google Earth Engine)

| Variable | GEE Source | Temporal Resolution | Available Period |
|---|---|---|---|
| NDVI (vegetation) | MODIS MOD13Q1 | Every 16 days | 2000–2024 |
| 2 m Air Temperature | ERA5-Land (ECMWF) | Daily | 2000–2024 |
| Soil Moisture (0–7 cm) | ERA5-Land (ECMWF) | Daily | 2000–2024 |
| Daily Precipitation | CHIRPS (UCSB) | Daily | 2000–2024 |
| Surface Water Bodies | Sentinel-2 SR | ~5 days | 2015–2024 |

Each variable generates:
- An **animated GIF** overlaid on the map, with the date shown on each frame.
- A **time-series plot** (spatial mean in the selected region) built with Plotly.

### Flood Risk Map

- Flood Hazard Index (FHI) by municipality, scaled 0–100.
- 16 municipalities of Tabasco available, loaded from local 100 m resolution GeoTIFFs.
- Color palette: green (low risk) → yellow → orange → red (critical risk).

### Local Hydrological Stations

- **San Pedro — SPTTB** (lat 17.79°, lon −91.16°): station on the San Pedro river, Balancán.
- **Boca del Cerro — BDCTB** (lat 17.43°, lon −91.48°): station on the Usumacinta river, Tenosique.
- Data is dynamically updated using the scraper daemon service or read from local CSV files. Temporal interpolation is applied for gaps of up to 7 days.
- Station markers appear on the map when no animation is active; clicking on them allows loading their complete series (2000–2024).

### Scrapers Daemon Service

The project includes a module to automate fetching local data directly from CONAGUA and SMN servers:
- **Automatic FTP Downloads**: Connects to the CONAGUA FTP server (`sih.conagua.gob.mx`) to download level data for the configured stations in CSV format.
- **Task Scheduler**: Uses `APScheduler` to run automatic downloads:
  - CONAGUA Hydros data: Every Monday at 02:00 AM.
  - CONAGUA Climas data: Every Monday at 02:30 AM.
  - SMN Data (Stub): Every hour.
- **Run on Startup (Bootstrap)**: Runs all configured scrapers immediately upon starting the container to ensure data is up to date.
- **Atomic Writes**: FTP downloads are saved atomically to prevent data corruption if the connection is interrupted.

### Data Export

To facilitate offline analysis, the system offers:
- **Analysis ZIP**: Exports a ZIP package containing the active time series data in CSV format, along with the animation GIFs and analysis metadata.

### Operation Modes

**Normal Mode** (single map):
- Select variable, year, and season in the sidebar.
- Animation generation with a real-time progress bar.
- Time-series chart below the map, combinable with local station data.

**Comparison Mode** (two synchronized maps):
- Panel A and Panel B with independent selection of variable, year, and season.
- Synchronized playback of both GIFs: pause, step-by-frame, speed control.
- Independent Plotly charts per panel.
- Load local station data per panel via checkboxes.

**Flood Risk Mode**:
- Activates the municipality control in the sidebar.
- Animation controls are locked to prevent overlay conflicts.
- Risk layers can be combined across multiple municipalities simultaneously.

### Other Technical Features

- Spatial selection using a rectangle drawn on the map (max. 8°×8°; 4°×4° for Sentinel-2).
- Seasons: Winter (Dec–Feb), Spring (Mar–May), Summer (Jun–Aug), Autumn (Sep–Nov), Full Year.
- Maximum range per request: 10 years.
- GIF disk cache with automatic cleanup every 60 minutes.
- Collapsible sidebar to maximize map area.

---

## Technical Architecture

```
┌────────────────────────────────────────────────────────────────────────┐
│                                Browser                                 │
│    TypeScript + Leaflet  │  Plotly.js  │  gifuct-js  │  Scalar UI      │
│    (map, UI controls, frame-by-frame animation, API documentation)     │
└───────────────────────────────────┬────────────────────────────────────┘
                                    │ HTTP / SSE
┌───────────────────────────────────▼────────────────────────────────────┐
│                        Flask Backend (Python 3)                        │
│    routes/  →  gee/  →  services/                                     │
└─────────────┬──────────────────────────────────────────┬───────────────┘
              │ earthengine-api                          │ Shared Volume
┌─────────────▼─────────────┐              ┌─────────────▼───────────────┐
│ Google Earth Engine (cloud)│             │   Scraper Daemon Service    │
│ MODIS · ERA5 · Sentinel-2 │              │   (APScheduler + FTP)       │
└───────────────────────────┘              └─────────────────────────────┘
```

**Typical Request Flow:**

1. The user draws a rectangle on the map and chooses a variable, year, and season.
2. The frontend sends two parallel requests:
   - `GET /api/<variable>-gif-bbox` — generates the animated GIF.
   - `GET /api/<variable>-timeseries-bbox` — retrieves the time series.
3. The backend queries the corresponding GEE collection, filters by date and region, and requests the GIF via `getVideoThumbURL`.
4. The GIF is downloaded from GEE, PIL overlays the date on each frame, and the file is saved in `static/gifs/`.
5. The backend responds with `{ gifUrl, bbox, dates, <values> }`.
6. The frontend overlays the GIF on the Leaflet map using `L.imageOverlay` and renders the chart using Plotly.

Generation progress is communicated in real time using **Server-Sent Events (SSE)** via the `/api/gif-progress/<task_id>` endpoint.

### Frontend Architecture

The TypeScript code in `src/ts/` is organized by responsibility:

```
src/ts/
├── main.ts               # Composition root — orchestrates initialization and wiring
├── apiClient.ts          # Typed HTTP client — all backend API requests
├── config.ts             # Endpoint URLs, available years, seasons, UI constants
├── types.ts              # API TypeScript interfaces (GifResponse, TimeseriesResponse, etc.)
├── state/
│   └── mapState.ts       # Global state store — bbox, mode, variable, series, players
└── modes/
    ├── normalMode.ts     # Normal mode logic (GIF generation + Panel A chart)
    ├── compareMode.ts    # Comparison mode logic (Paneles A/B, sync, mapB)
    └── floodRiskMode.ts  # Risk mode logic (FHI overlays by municipality)
```

- **`main.ts`** initializes the Leaflet map, mode modules, and listeners. It contains no business logic.
- **`apiClient.ts`** encapsulates all `fetch()` calls, including SSE progress and typed error handling.
- **`mapState.ts`** holds session state: selected bbox, active mode, loaded time series, and references to animation players (`GifPlayer`, `SyncPlayer`, `SoloPlayer`).
- **`modes/*.ts`** contain specific behavior for each mode of operation and access state exclusively through `mapState`.

---

## Prerequisites

| Component | Minimum Version Recommended |
|---|---|
| Python | 3.11 |
| Node.js | 18 |
| npm | 9 |
| uv | Latest — recommended Python package manager |

**Google Earth Engine Account:**
- You need an approved GEE account and a Google Cloud project with the Earth Engine API enabled.
- More information: [earthengine.google.com](https://earthengine.google.com/)

**Python Dependencies** (see `pyproject.toml`):
- Managed and synchronized automatically using `uv`.

**Node Dependencies** (see `package.json`):
- `vitest` for unit and integration testing (TypeScript).
- `playwright` for browser E2E tests.
- `typescript`, `@types/leaflet`.

---

## Installation and Configuration

### 1. Clone the repository

```bash
git clone https://github.com/ElGuill3/distributionMapApp.git
cd distributionMapApp
```

---

### 2. Configure Virtual Environment and Python Dependencies

We recommend using **[uv](https://github.com/astral-sh/uv)** to manage your virtual environment and dependencies quickly.

```bash
# Sync dependencies and create the virtual environment automatically
uv sync
```

This will create a virtual environment in the `.venv/` folder at the root of the project and install all project and development dependencies.

To activate the virtual environment in your terminal:

```bash
# Linux / macOS:
source .venv/bin/activate
# Windows (PowerShell):
.venv\Scripts\Activate
# Windows (CMD):
.venv\Scripts\activate.bat
```

Or you can run any command directly using `uv run`:
```bash
uv run app.py
```

---

### 3. Configure Environment Variables

Copy the `.env.example` file to `.env` in the root of the project and configure the variables:

```bash
cp .env.example .env
```

> [!IMPORTANT]
> You must configure `GEE_PROJECT` with the real ID of your Google Cloud project. To see the list of your projects and find the correct ID, you can run:
> ```bash
> gcloud projects list
> ```

| Environment Variable | Default Value | Description |
|---|---|---|
| `GEE_PROJECT` | `inundaciones-proyecto` | Google Cloud project ID with the Earth Engine API enabled. |
| `FLASK_DEBUG` | `false` | Enables Flask debug mode if set to `true`. |
| `CONAGUA_HIDROS_STATIONS` | `BDCTB,SPTTB` | Keys of hydrometric stations to scrape (comma-separated). |
| `CONAGUA_CLIMAS_STATIONS` | *(empty)* | Keys of climatological stations to scrape (comma-separated). |
| `MAX_SPAN_DEG` | `8.0` | Maximum spatial span allowed in degrees for GEE requests. |
| `MAX_YEARS_RANGE` | `10.0` | Maximum date range allowed in years for GEE requests. |
| `MAX_SPAN_DEG_S2` | `4.0` | Restrictive limit in degrees for Sentinel-2 (due to high resolution). |
| `MAX_TOTAL_PIXELS` | `26000000` | Maximum pixel limit for GEE processing. |
| `BASE_PIXELS_PER_FRAME` | `589824` | Base pixel size per animation frame (768x768). |
| `BASE_PIXELS_S2` | `262144` | Base pixel size per frame for Sentinel-2 (512x512). |
| `MIN_GIF_DIM` | `256` | Minimum allowed dimensions in pixels for the generated GIF. |
| `GIF_MAX_AGE_MINUTES` | `60` | Maximum age in minutes of cached GIFs before cleanup. |
| `GIF_CLEANUP_INTERVAL_S` | `600` | Cleanup daemon interval in seconds (default 10 minutes). |
| `GEE_MODIS_NDVI` | `MODIS/061/MOD13Q1` | GEE NDVI dataset ID. |
| `GEE_ERA5_LAND_DAILY` | `ECMWF/ERA5_LAND/DAILY_AGGR` | GEE ERA5-Land temperature and soil moisture dataset ID. |
| `GEE_CHIRPS_DAILY` | `UCSB-CHG/CHIRPS/DAILY` | GEE CHIRPS precipitation dataset ID. |
| `GEE_S2_SR` | `COPERNICUS/S2_SR_HARMONIZED` | GEE Sentinel-2 SR Harmonized dataset ID. |
| `RATE_LIMIT_ENABLED` | `true` | Enables or disables rate limiting. |

---

### 4. Authenticate Google Earth Engine

```bash
earthengine authenticate
```

Follow the on-screen instructions. Once authenticated, verify that it works:

```bash
python -c "import ee; ee.Initialize(); print('GEE OK')"
```

Make sure `.env` contains your correct Google Cloud project ID (`GEE_PROJECT`).

> **Don't have a GEE project?** Go to [console.cloud.google.com](https://console.cloud.google.com), create a project, enable the *Earth Engine API*, and copy the project ID.

---

### 5. Local Station Data

The files `SPTTB.csv` and `BDCTB.csv` must be placed in the `data/stations/` directory. Expected format:

```
<lines 1–6: metadata (automatically skipped)>
Fecha,Nivel(m),...
YYYY-MM-DD,value,...
```

If you need to add new stations, register them in `config.py` under `LOCAL_STATIONS`.

---

### 6. Verify Flood Risk Maps

The FHI GeoTIFFs must be placed in `data/mapa_riesgo/municipios/` with the filename `fhi_<municipio>_100m.tif`. The repository already includes the 16 municipalities of Tabasco.

---

### 7. Install Node Dependencies and Compile TypeScript

> [!IMPORTANT]
> Compiling the TypeScript code is **mandatory** before starting the application for the first time. If you do not run this step, the UI will display a blank page with 404 errors when trying to load `main.js`.

```bash
npm install
npm run build:ts
```

For development with automatic recompilation on file saves:

```bash
npm run watch:ts
```

---

### 8. Run Tests (Optional but Recommended)

```bash
# Unit and integration tests (Vitest)
npm test

# Unit tests in watch mode
npm run test:watch

# E2E tests (requires Chromium browser)
# First start the static file server in another terminal:
python -m http.server 8080
# Then run the E2E suite:
BASE_URL=http://localhost:8080 npm run test:e2e

# E2E tests in UI mode (for debugging)
BASE_URL=http://localhost:8080 npm run test:e2e:ui
```

---

### 9. Run with Docker (Recommended for Production)

The project is dockerized using a multi-container architecture that separates the web server from the scraping service. Both containers share a data volume (`data_stations`) so the web server can access downloaded station files in real time.

**Prerequisites:**
- **Docker** and **Docker Compose** installed.
- Google Earth Engine credentials configured on your host system (or configure the volume path for credentials).

**Bring up the environment:**

```bash
docker compose up --build
```

This builds and launches:
- The `web` service exposed on port `5000` (running the Flask app).
- The `scraper` service running the weekly/hourly scheduler.

To run the services in the background:

```bash
docker compose up -d
```

---

## Basic Usage

### Start the Application

```bash
python app.py
```

Open your browser and navigate to: **http://127.0.0.1:5000**

---

### Normal Mode — Animating a Variable

1. **Draw a rectangle** on the map to define the region of interest (max. ~8°×8°).
2. Expand the section of the desired variable in the sidebar (e.g. *NDVI*).
3. Select the **year** and **season**.
4. Click **"Generar animación"** (Generate animation).
5. A progress bar will appear while GEE processes the GIF (takes 15–60s depending on region size and date range).
6. The GIF will overlay on the map. Below it, the **time-series chart** showing the spatial mean for the selected region will render.
7. Use the **playback bar** at the bottom to play, pause, step frames, and adjust speed.
8. To reset and start over, click **"Limpiar"** (Clear) in the top toolbar.

> **Note on Sentinel-2 (water bodies):** maximum allowed area is 4°×4° due to the high resolution (10 m) of this sensor.

---

### Comparison Mode — Two Periods Side-by-Side

1. Click **"Comparar años"** (Compare years) in the sidebar. Sidebar controls lock and two panels (A and B) appear with separate selectors.
2. In Panel A: choose variable, year, and season; click **"Generar panel A"**.
3. In Panel B: choose variable, year, and season; click **"Generar panel B"**.
4. Once both load, playback **synchronizes automatically**.
5. To overlay local station data on either panel, check the corresponding boxes under the selectors (data loads matching the panel's season).
6. To exit, click **"Comparar años"** again. The state resets completely.

---

### Flood Risk Mode

1. Click **"Mapa de riesgo"** (Risk Map) in the sidebar. Animation controls lock.
2. Select one or more municipalities. FHI overlays will load on the map.
3. The colorbar shows the risk scale (0 = very low, 100 = critical).
4. Uncheck a municipality to remove its layer.
5. Click **"Mapa de riesgo"** again to exit the mode.

---

### Local Stations (Normal Mode)

In the **"Estaciones locales (nivel)"** section in the sidebar:
1. Choose **year** and **season**.
2. Click **"Cargar serie de nivel"** (Load level series).
3. The series will be added to the chart below the map alongside any active GEE variables.

You can also click a station marker on the map and choose **"Ver datos 2000–2024"** to load its full series.

---

## Project Structure

```
distributionMapApp/
│
├── app.py                    # Flask entry point: initializes GEE, registers blueprints
├── config.py                 # Global constants: paths, GEE collections, limits, stations
├── pyproject.toml            # Python project dependencies and metadata (managed by uv)
├── uv.lock                   # Python dependency lockfile (managed by uv)
├── package.json              # Node dependencies and TS compile scripts
├── tsconfig.json             # TypeScript compiler settings
├── openapi.yaml              # OpenAPI 3.1.0 REST API specification
├── docker-compose.yml        # Multi-container Compose configuration
├── Dockerfile                # Multi-stage Dockerfile for web and scraper
│
├── tests/                    # Unit, integration (Vitest/pytest), and E2E (Playwright) tests
│
├── gee/                      # Google Earth Engine processing modules
│   ├── ndvi.py               # NDVI — MODIS MOD13Q1
│   ├── temperature.py        # Temperature — ERA5-Land (Kelvin → Celsius)
│   ├── soil.py               # Soil moisture — ERA5-Land
│   ├── precipitation.py      # Daily precipitation — CHIRPS
│   ├── water.py              # Water bodies — Sentinel-2 SR (NDWI)
│   ├── flood_risk.py         # Renders FHI maps from local GeoTIFFs
│   └── utils.py              # Shared utils: bbox validation, seasons, GIF dimensions
│
├── scrapers/                 # Automatic scrapers for local data
│   ├── base.py               # Abstract Base Scraper class
│   ├── conagua.py            # FTP scraper for CONAGUA station data
│   ├── smn.py                # Stub scraper for SMN data
│   └── runner.py             # Scheduled runner daemon (APScheduler)
│
├── routes/                   # Flask Blueprints — REST API endpoints
│   ├── gif_routes.py         # GET /api/<var>-gif-bbox
│   ├── timeseries_routes.py  # GET /api/<var>-timeseries-bbox
│   ├── flood_routes.py       # GET /api/flood-risk-municipio
│   ├── station_routes.py     # GET /api/local-station-level-range
│   ├── progress_routes.py    # GET /api/gif-progress/<task_id> (SSE)
│   └── export_routes.py      # POST /api/export/bundle
│
├── services/
│   ├── gif_service.py        # Downloads GEE GIFs, annotates with PIL, cache & cleanup
│   ├── station_service.py    # Reads and preprocesses local station CSVs
│   └── export_service.py     # Decoupled ZIP bundle exports (CSV + GIFs + metadata)
│
├── data/
│   ├── mapa_riesgo/
│   │   └── municipios/       # Municipal FHI GeoTIFFs (fhi_<municipio>_100m.tif)
│   └── stations/             # Local level series (downloaded by scrapers)
│
├── static/                   # Files served directly to the browser
│   ├── main.js               # Compiled JavaScript from TypeScript
│   ├── styles.css            # Main stylesheet
│   ├── gifs/                 # Generated GIFs (temp cache, automatically cleaned)
│   └── flood_maps/           # Rendered risk map PNGs
│
├── src/ts/                   # TypeScript source code (compiles to static/)
│   ├── main.ts               # Composition root — orchestrator and wiring
│   ├── apiClient.ts          # Typed HTTP client — backend calls
│   ├── config.ts             # UI constants, seasons, endpoint URLs
│   ├── types.ts              # TypeScript API typings and interfaces
│   ├── state/
│   │   └── mapState.ts       # Global state store (bbox, mode, variables, players)
│   ├── modes/                # Sub-modules for each operation mode
│   │   ├── normalMode.ts     # Normal Mode logic
│   │   ├── compareMode.ts    # Comparison Mode logic
│   │   └── floodRiskMode.ts  # Flood Risk Mode logic
│   ├── map/
│   │   └── overlays.ts       # Leaflet overlay control and colorbars
│   ├── ui/
│   │   ├── gifPlayer.ts      # GIF frame decoder and playback controller
│   │   ├── chart.ts          # Plotly chart wrapper
│   │   └── progress.ts       # Progress bar modal overlay
│   └── listeners/
│       └── variableListeners.ts # Variable listener factory
│
└── templates/
    ├── index.html            # Main HTML layout template
    └── scalar.html           # Interactive API docs (Scalar UI template)
```

---

## API Endpoints

| Endpoint | Method | Key Parameters | Response |
|---|---|---|---|
| `GET /api/ndvi-gif-bbox` | `GET` | `start`, `end`, `bbox`, `task_id` | `{ gifUrl, bbox, dates, ndvi[] }` |
| `GET /api/era5-temp-gif-bbox` | `GET` | `start`, `end`, `bbox`, `task_id` | `{ gifUrl, bbox, dates, temp[] }` |
| `GET /api/era5-soil-gif-bbox` | `GET` | `start`, `end`, `bbox`, `task_id` | `{ gifUrl, bbox, dates, soil_pct[] }` |
| `GET /api/imerg-precip-gif-bbox` | `GET` | `start`, `end`, `bbox`, `task_id` | `{ gifUrl, bbox, dates, precip_mm[] }` |
| `GET /api/water-gif-bbox` | `GET` | `start`, `end`, `bbox`, `task_id` | `{ gifUrl, bbox, dates, water_ha[] }` |
| `GET /api/<var>-timeseries-bbox` | `GET` | `start`, `end`, `bbox` | `{ dates, bbox, <values>[] }` |
| `GET /api/gif-progress/<task_id>` | `GET` | — | SSE: `{ progress: 0–100, message }` |
| `GET /api/flood-risk-municipio` | `GET` | `muni` | `{ mapUrl, bbox }` |
| `GET /api/local-station-level-range` | `GET` | `station`, `start`, `end` | `{ station, dates, level_m[] }` |
| `POST /api/export/bundle` | `POST` | `gifPaths`, `seriesData`, `bbox`, `metadata` | ZIP Archive (CSV data + GIFs + metadata) |
| `GET /api/docs` | `GET` | — | Interactive Scalar UI API documentation |
| `GET /api/docs/openapi.yaml` | `GET` | — | OpenAPI 3.1.0 specification in YAML format |

---

## Development Notes

### Recompiling TypeScript

After modifying any file in `src/ts/`, compile them using:

```bash
npm run build:ts
```

For watch mode (recompiles automatically on change):

```bash
npm run watch:ts
```

### Testing Stack

**Vitest** — unit and integration tests:
```bash
npm test              # runs all tests
npm run test:watch    # watch mode
```

**Playwright** — End-to-End browser tests:
```bash
# Start file server in another shell:
python -m http.server 8080

# Run E2E suite:
BASE_URL=http://localhost:8080 npm run test:e2e

# Or in UI mode:
BASE_URL=http://localhost:8080 npm run test:e2e:ui
```

### Quality Tools

**Python** — Coverage, linting, and formatting checks using `pytest-cov` and `ruff`.

```bash
uv run scripts/python/quality/coverage.sh
uv run scripts/python/quality/lint.sh
uv run scripts/python/quality/format.sh
```

**TypeScript** — Linting and formatting checks using ESLint and Prettier.

```bash
npm run lint:ts
npm run format:ts
npm run quality:ts
```

### Google Earth Engine API Limits

- **Maximum date span per request:** 10 years.
- **Maximum bounding box span:** 8°×8° (4°×4° for Sentinel-2).
- **Maximum total pixels:** 26,000,000.
- Responses from GEE take 15s to several minutes depending on parameters.

### GIF Cache

GIFs are cached under `static/gifs/` and cleared by the daemon when they exceed **60 minutes of age** (`GIF_MAX_AGE_MINUTES` in `config.py`).

### Production Deployment

```bash
pip install gunicorn
gunicorn -w 4 -b 0.0.0.0:8000 app:app
```

We recommend placing an Nginx reverse proxy in front of the Flask app to serve static assets directly.

---

## Design Decisions

The frontend architecture was structured following a **Spec-Driven Development (SDD)** process. The initial `main.ts` (~1334 lines) was split into modules with decoupled responsibilities:

- **`main.ts`** acts as a *composition root*, wiring up infrastructure and routing actions to mode handlers.
- **`apiClient.ts`** centralizes all HTTP and SSE requests with strict return types and error mappings.
- **`state/mapState.ts`** serves as a typed central state store with read/write accessors.
- **`modes/`** holds the logic for specific features (`normalMode`, `compareMode`, `floodRiskMode`), making it simple to add new modes without modifying core files.

---

## Future Scope

- Export time-series and station levels to CSV from the UI.
- Support for irregular polygon geometries (in addition to boxes).
- Integration of additional local hydrological stations.

---

## Credits and Sources

| Source | Description |
|---|---|
| [MODIS MOD13Q1](https://developers.google.com/earth-engine/datasets/catalog/MODIS_061_MOD13Q1) | NDVI, 250 m, every 16 days |
| [ERA5-Land Daily](https://developers.google.com/earth-engine/datasets/catalog/ECMWF_ERA5_LAND_DAILY_AGGR) | Temp & soil moisture, ~9 km |
| [CHIRPS Daily](https://developers.google.com/earth-engine/datasets/catalog/UCSB-CHG_CHIRPS_DAILY) | Daily precipitation, ~5.5 km |
| [Sentinel-2 SR Harmonized](https://developers.google.com/earth-engine/datasets/catalog/COPERNICUS_S2_SR_HARMONIZED) | Water bodies (NDWI), 10 m |
| [CONAGUA / IMTA](https://www.gob.mx/conagua) | Local hydrometric and meteorological station data |
| [Google Earth Engine](https://earthengine.google.com/) | Cloud geospatial processing engine |

# Hydrometeorological Viewer — distributionMapApp

*Leer esto en [Español](README.md).*

Interactive web application to visualize animations and time series of hydrometeorological variables over the state of Tabasco, Mexico, using Google Earth Engine as the main satellite data source.

## Local quick start (app only)

First synchronize the app project and then run its public command from this
repository root:

```bash
uv sync
uv run distribution-map
```

`uv sync` installs the dependencies and registers the project command. The
public command is app-only: it compiles the TypeScript frontend through the
clean deterministic driver (`scripts/build-typescript.mjs`, also exposed as
`npm run build:ts`), which compiles TypeScript and copies the authored
`frontend/src/styles/styles.css` to its unchanged public `/static/styles.css` URL, validates the application dependency boundary, and serves
Flask in the foreground at `http://127.0.0.1:5000`. It never requires the
sibling model repository and never starts the Forecast API or the automatic
worker.

Prepare these prerequisites first:

- This app's existing `.venv/` and `node_modules/`, plus a Node.js runtime;
  the launcher performs no installation.
- `GEE_PROJECT` and one existing local Earth Engine authorization source:
  persistent Earth Engine credentials (normally
  `~/.config/earthengine/credentials`), a credential file selected by
  `GOOGLE_APPLICATION_CREDENTIALS`, or gcloud Application Default Credentials
  (normally `~/.config/gcloud/application_default_credentials.json`).

The command first validates these prerequisites, performs an initial download
of the CONAGUA stations configured in `CONAGUA_HIDROS_STATIONS` and
`CONAGUA_CLIMAS_STATIONS`, compiles the frontend, and then serves the app in the
foreground. No separate station download command is needed. Downloads finish
before Flask loads its catalog; the periodic scraper scheduler is not started.
Responses are downloaded into a temporary directory. Latin-1 CSVs and reversible
UTF-8-as-Latin-1 decoding errors are normalized to UTF-8 before validation,
without altering observations. Valid accented text is preserved. Downloads only replace local CSVs
if they contain metadata for a station with known coordinates and at least one
valid date and measurement. If any download fails, the command warns and uses
available usable local data. If no usable station remains, it exits with code 2
without starting Flask. Data stays in the Git-ignored `data/stations/` directory;
startup may take longer while CONAGUA responds or the downloader tries FTP.
Startup prints downloader progress and per-station rejection reasons to stderr,
including missing files, invalid metadata, unrecognized measurement columns
(check CSV encoding), and malformed rows. These messages distinguish download
failures from validation rejection; the final summary remains on stdout.
Press `Ctrl+C` to stop the
backend; diagnostic logs remain under `.cache/bdctb-local-app/logs/` with the
same private scheme as the general supervisor (`0600` per file, `0700` for the
directory, three files of at most 1 MiB each).

Without the model stack there is no valid forecast cache: the application keeps
working, but its forecast routes must not be presented as operational
prediction.

## Deferred path: local stack with automatic forecasting (compatibility)

The full stack with model, Forecast API, and worker remains preserved in
`scripts/run_local_forecast_stack.py` for deferred use; it is no longer the
target of the public command:

```bash
.venv/bin/python scripts/run_local_forecast_stack.py
.venv/bin/python scripts/run_local_forecast_stack.py --model-repo /path/to/repository
```

The model is an explicit local dependency that remains in a separate
repository. By default, the script expects the sibling checkout at
`../distributionMapApp-model-research`; it never downloads the model
automatically.

The model repository selects its canonical paths through
`configs/model/bdctb_runtime_paths_v1.json`. That descriptor currently resolves
the calibrated bundle at
`runs/bdctb-exogenous-qgb-real-v1-calibrated-20260730`. The supervisor also
discovers the versioned GEFS weights there; it does not modify credentials or
install model dependencies.

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

The script first validates these prerequisites and compiles the current
TypeScript application directly with the local TypeScript compiler
(`node_modules/.bin/tsc`). It then starts
three foreground processes: the app at
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

Systemd, host users, provisioning, and installation are explicitly out of
scope for this local workflow.

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
- The municipal API also accepts registered Matplotlib palette names (for example, `palette=viridis`), resolved through the current colormap registry; default FHI colors and cached PNG URLs are unchanged.

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

### Safe browser text rendering

Station names, municipality labels, station IDs and inundation legend values are rendered as data, never interpreted as server-supplied HTML. Both map panels share the station popup renderer; icons and forecast actions retain their existing behavior.

### Data Export

To facilitate offline analysis, the system offers:
- **Analysis ZIP**: Exports a ZIP package containing the active time series data in CSV format, along with the animation GIFs and analysis metadata.
  GIF paths must stay within `static/gifs/` and end in `.gif`; `gifs/name.gif` and `/static/gifs/name.gif` are accepted. Traversal, absolute paths, other files and escaping symlinks return HTTP 400; a missing permitted GIF returns HTTP 404.

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
│    backend/routes/ → backend/gee/ → backend/services/                 │
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

Generation progress uses **Server-Sent Events (SSE)** at `/api/gif-progress/<task_id>`. The registry is **process-local**: use one application process with concurrent request threads so generation and SSE reach the same registry.

| Setting | Default | Behavior |
| --- | --- | --- |
| `SSE_TASK_QUEUE_TIMEOUT_S` | 60 seconds | Wait between keep-alive comments. |
| `SSE_PROGRESS_RETENTION_S` | 3600 seconds, minimum 1 | Completed/error progress expires from producer completion; running tasks do not expire. |
| `SSE_MAX_PROGRESS_TASKS` | 1024, minimum 1 | Evict completed registrations first, then the oldest if all are running. |
| `SSE_MAX_PROGRESS_MESSAGES` | 128, minimum 2 | Discard oldest buffered progress without blocking generation; retain the latest terminal pair. |

- Closing a stream cleans its queue on completion, error, or client disconnect. An old producer or stream never removes a newer registration with the same ID.
- Expiry is checked on registry access and on cleanup daemon ticks (`GIF_CLEANUP_INTERVAL_S`). An evicted/expired ID emits the existing missing-task SSE event; already attached streams retain their own queue.
- Multiple processes or replicas require a shared progress backend; none is configured by this application. A load balancer alone does not make the registry shared.

### Frontend Architecture

The TypeScript code in `frontend/src/ts/` is organized by responsibility:

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
- **`mapState.ts`** holds session state: selected bbox, active mode, loaded time series, and references to animation players (`GifPlayer`, `SyncPlayer`, `SoloPlayer`). `GifPlayer` owns its frame blob URLs: reloading releases replaced frames, disposing invalidates pending loads, and a failed or superseded load releases its candidate frames without replacing the current animation.
- **`normalMode.ts`** gives each generation its own lifecycle: obsolete responses, decode completions and SSE callbacks cannot replace or clear newer state. Clearing/reinitializing the mode invalidates pending generations; the existing animation stays owned until a current replacement has decoded successfully. Frame seasons and years use the API's UTC calendar dates, independently of the browser's timezone. `normalGeneration.ts` uses the same captured ownership check for error feedback and the payload-free `generationComplete` event, so obsolete completions cannot unlock a newer request, including clear/mode changes between promise resolution and its continuation.
- **`compareMode.ts`** owns generations per panel, so A and B can finish independently. Shared progress belongs to the latest pending request; clearing a panel or leaving/reinitializing comparison invalidates obsolete work. Failed/stale decoded candidates are disposed without replacing owned frames, and late B view-sync callbacks cannot restore cleared state.
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
| `RATE_LIMIT_GIF` | `30/minute` | Each GIF endpoint, per IP. |
| `RATE_LIMIT_TIMESERIES` | `60/minute` | Each timeseries endpoint, per IP. |
| `RATE_LIMIT_EXPORT` | `10/minute` | Export bundles, per IP. |
| `RATE_LIMIT_FLOOD` | `60/minute` | Flood maps/detection, independently per endpoint and IP. |
| `RATE_LIMIT_FLOOD_STATS` | `30/minute` | Flood statistics, per IP. |
| `RATE_LIMIT_STATION` | `60/minute` | Each station endpoint, per IP. |
| `RATE_LIMIT_FORECAST` | `60/minute` | Forecast proxy, per IP. |

Processing guards `MAX_SPAN_DEG`, `MAX_YEARS_RANGE` and `MAX_SPAN_DEG_S2` must be finite positive numbers (fractional values are supported). Empty, malformed, zero, negative, NaN or infinite values abort startup with `<ENV_KEY> must be a finite number greater than zero.` without echoing the value. Defaults remain 8°, 10 years and 4° respectively.

The HTML page embeds only these three numeric processing limits as JSON before loading the client modules. Map drawing uses the configured span while keeping the existing `MAX_SPAN_DEG` export; missing/malformed client context falls back to the declared defaults. Normal/comparison requests check the configured span and UTC year range before changing animation or progress ownership. Flood detection checks `MAX_SPAN_DEG_S2` for both satellites before clearing layers or disabling the button. Rejected requests retain the current view and send no HTTP/SSE request. Server validation remains authoritative; reload the page after changing server settings.

Rate quotas use Flask-Limiter notation (for example, `1/minute` or `10/minute;100/hour`). Every count must be positive. Invalid or empty values abort startup with `<ENV_KEY> must specify positive request rates.` without echoing the value, even when limiting is disabled. Quotas are independent per endpoint/IP, process-local, and count rejected HTTP requests too. Over quota returns the existing JSON HTTP 429 response with `Cache-Control: no-store`.

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

# E2E tests: build first; Playwright starts the rendered frontend server
npm run build:ts
npm run test:e2e

# E2E tests in UI mode (for debugging)
npm run test:e2e:ui
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
│
├── tests/                    # Python tests (pytest)
│
├── backend/                  # Backend implementation packages
│   ├── routes/                   # Flask Blueprints — REST API endpoints
│   │   ├── gif_routes.py         # GET /api/<var>-gif-bbox
│   │   ├── timeseries_routes.py  # GET /api/<var>-timeseries-bbox
│   │   ├── flood_routes.py       # GET /api/flood-risk-municipio
│   │   ├── station_routes.py     # GET /api/local-station-level-range
│   │   ├── progress_routes.py    # GET /api/gif-progress/<task_id> (SSE)
│   │   └── export_routes.py      # POST /api/export/bundle
│   ├── gee/                      # Google Earth Engine processing modules
│   │   ├── ndvi.py               # NDVI — MODIS MOD13Q1
│   │   ├── temperature.py        # Temperature — ERA5-Land (Kelvin → Celsius)
│   │   ├── soil.py               # Soil moisture — ERA5-Land
│   │   ├── precipitation.py      # Daily precipitation — CHIRPS
│   │   ├── water.py              # Water bodies — Sentinel-2 SR (NDWI)
│   │   ├── flood_risk.py         # Renders FHI maps from local GeoTIFFs
│   │   └── utils.py              # Shared utils: bbox validation, seasons, GIF dimensions
│   ├── services/
│   │   ├── gif_service.py        # Downloads GEE GIFs, annotates with PIL, cache & cleanup
│   │   ├── station_service.py    # Reads and preprocesses local station CSVs
│   │   └── export_service.py     # Decoupled ZIP bundle exports (CSV + GIFs + metadata)
│   └── scrapers/             # Automatic scrapers for local data
│       ├── base.py               # Abstract Base Scraper class
│       ├── conagua.py            # FTP scraper for CONAGUA station data
│       ├── smn.py                # Stub scraper for SMN data
│       └── runner.py             # Scheduled runner daemon (APScheduler)
│
├── data/
│   ├── mapa_riesgo/
│   │   └── municipios/       # Municipal FHI GeoTIFFs (fhi_<municipio>_100m.tif)
│   └── stations/             # Local level series (downloaded by scrapers)
│
├── static/                   # Files served directly to the browser
│   ├── main.js               # Compiled JavaScript from TypeScript
│   ├── styles.css            # Published copy of frontend/src/styles/styles.css
│   ├── gifs/                 # Generated GIFs (temp cache, automatically cleaned)
│   └── flood_maps/           # Rendered risk map PNGs
│
├── frontend/                        # Browser sources and tests
│   ├── src/
│   │   ├── styles/styles.css        # Authored styles published to static/ by build:ts
│   │   └── ts/                      # TypeScript compiled to static/
│   │       ├── main.ts              # Composition root and initialization
│   │       ├── apiClient.ts         # Typed HTTP client
│   │       ├── config.ts            # URLs, seasons and UI configuration
│   │       ├── state/               # Shared map state
│   │       ├── modes/               # Normal, comparison and flood modes
│   │       ├── sidebar/             # Sidebar controls
│   │       ├── map/                 # Leaflet overlays
│   │       ├── ui/                  # GIFs, charts and progress
│   │       └── utils/               # Dates, limits and text escaping
│   └── tests/
│       ├── unit/                    # Source-only Vitest tests (no prior build)
│       └── e2e/                     # Playwright and provider-free test server
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

**Common parameters:**
- `start` / `end`: dates in `YYYY-MM-DD` format. All GIF and timeseries routes, including NDVI, also accept `year` + `season`; a complete explicit date pair takes precedence, otherwise seasonal shorthand replaces the pair.
- `bbox`: JSON array `[minLon, minLat, maxLon, maxLat]` in decimal degrees (WGS-84). Requires `minLon < maxLon`, `minLat < maxLat`, lon within `[-180, 180]`, lat within `[-90, 90]` and finite values; anything else is rejected with 400.
- `ratio`: GIF width/height ratio; must be a positive finite number.

---

## Development Notes

### Recompiling TypeScript

After modifying any file in `frontend/src/ts/`, compile them using:

```bash
npm run build:ts
```

For watch mode (recompiles automatically on change):

```bash
npm run watch:ts
```

### Testing Stack

**Vitest** — unit and integration tests:
Tests import authored TypeScript directly and run without generated `static/` JavaScript. Build output is still required to serve the application.
```bash
npm test              # runs all tests
npm run test:watch    # watch mode
```

**Playwright** — End-to-End browser tests:
```bash
npm run build:ts
npm run test:e2e
# Or in UI mode:
npm run test:e2e:ui
```

The runner starts `frontend/tests/e2e/server.py --port 8080` on loopback with real Jinja rendering and validated runtime limits, without application providers. API calls return HTTP 503 unless mocked by the browser test. CDN dependencies still require network access. An existing server is never silently reused.

Use `PLAYWRIGHT_EXECUTABLE_PATH=/absolute/path/to/chromium npm run test:e2e` for an already provisioned compatible portable browser, or the default Playwright Chromium installation. For an explicitly selected running server, use `BASE_URL=http://127.0.0.1:5000 SKIP_WEB_SERVER=1 npm run test:e2e`; this opts out of the synthetic API boundary.

The action checks exercise the public generation event, actual modal close/Escape, and Leaflet drawing plus the Generate button against a synthetic provider failure. They assert dates/bbox, recovery, and export remaining disabled. CSS-only toolbar checks are not end-to-end export proof; real provider processing and ZIP/PNG downloads remain outside this browser suite.

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

### Runtime Initialization

Importing `app` constructs Flask routes without starting Earth Engine, creating runtime directories or launching GIF cleanup. `uv run distribution-map` and `python app.py` initialize before serving; WSGI `app:app` initializes on its first request. `initialize_runtime()` is process-local and thread-safe: repeated calls do not start duplicate cleanup threads, and EE failure prevents cleanup startup. Dependency preflight never initializes runtime.

Synthetic tests set `app.config["INITIALIZE_RUNTIME"] = False` to disable request-triggered startup. Explicit initializer calls still require mocked providers and isolated files.

### Production Deployment

```bash
pip install gunicorn
gunicorn --workers 1 --threads 4 -b 0.0.0.0:8000 app:app
```

Keep one worker for the process-local SSE registry; threads allow the SSE request to run while GIF generation is in progress. Do not scale this command to multiple workers/replicas without first adding a shared progress backend. Configure server/proxy timeouts for generation requests, which can take several minutes.

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

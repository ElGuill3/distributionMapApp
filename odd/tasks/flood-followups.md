# Flood risk follow-ups
Follow-up work after the flood susceptibility model landed on main (PRs #7–#15): address non-blocking review findings, align the OpenAPI spec with live routes, and slim app dependencies.
Branch `feat/flood-followups`. Sentinel-1 deep-learning labels are explicitly deferred by the user.

## Specs
- S1 (user): "vamos con las primeras 3 mejoras" — first improvement listed: "las observaciones que no bloquean de las revisiones, sobre todo en `publish.py`, `floodRiskMode.ts` y `flood_routes.py`". Fix the real issues, document or skip the rest with a reason.
- S2 (user): second improvement: "alinear `openapi.yaml` con las rutas reales". Documented-but-unserved: `/api/water-gif-bbox`, `/api/water-timeseries-bbox`; served-but-undocumented: `/api/flood-detection`, `/api/flood-stats`, `/api/local-stations` (`/api/docs*` are the docs themselves).
- S3 (user): third improvement: "mover `rasterio` y `matplotlib` al grupo `floodmodel`". matplotlib has no remaining user, so it is removed instead of moved.
- S4 (user): "las etiquetas de Sentinel lo dejaremos para despues para revisar si mejoraria o no" — out of scope.

## Tasks
- F1 [S3] inline; done — rasterio moved to floodmodel group, matplotlib (+fonttools, kiwisolver) removed, conftest matplotlib mock removed; 3 tests (pyproject + cold-process app import with both blocked); 707 backend pass
- F2 [S2] inline; done — removed /api/water-gif-bbox and /api/water-timeseries-bbox (never served), documented /api/flood-detection, /api/flood-stats, /api/local-stations; new test pins spec paths == served /api routes (excluding /api/docs*); 18 paths; 708 backend pass
- F3 [S1] inline; in progress — triage done (31 items, L4). F3a pipeline done: publish atomic swap + stale tiles + input checks + empty-raster guard + fixed stats schema (rank None) + named constants; GAUL empty geometries dropped; CLI dem/resolution guards, CEM warning, STATE constants; score_events NODATA/NaN masking; report.json records params/seed/features; validate() scope documented. 14 new tests, 722 backend pass. F3b done: metadata route returns 503 JSON when metadata.json is missing/corrupt (+openapi 503), tile test parametrized z7-12 with clear failure, duplicate OpenAPI subset test reduced to the FHI-removal guard (C1 cache-header part was a false positive: /api/flood-risk prefix already cached 24 h). F3c done: TilePixelCache drops failed loads (retry on next hover), readout tells read errors apart from no-data and ignores stale hovers, municipality index + warning, toggle re-checks mode/checkbox after load and removes the old outline first, legend/choropleth colours from metadata via --flood-class-N; e2e requires a real class readout and covers a failing tile; 7 vitest + 1 e2e new (275 vitest, 16 e2e). Pre-existing duplicate CSS sections (colorbars, flood toggle, municipios-grid) left as a separate follow-up: deduplicating reorders the whole cascade. F3d docs pending

## Log
- L1: "vamos con las primeras 3 mejoras, las etiquetas de Sentinel lo dejaremos para despues para revisar si mejoraria o no"
- L2: Review finding texts are not retrievable (lineages burned); only locations survive, so an explorer reconstructs them from the reviewed commits.
- L3: Live vs spec diff on main 7fdcdfa: documented not served ['/api/water-gif-bbox', '/api/water-timeseries-bbox']; served not documented ['/api/docs', '/api/docs/openapi.yaml', '/api/flood-detection', '/api/flood-stats', '/api/local-stations']. matplotlib: no import outside tests/conftest; rasterio: only backend/floodmodel.
- L4: Triage (explorer mv75t6qy-4-2cjn, reconstructed from reviewed locations): FIX A1,A2,A4,B2,B4,B6,B7,B8,B10,C1,C2,C3,C4,C5,C6,C7,D4,E1,E5; DOC A3,B1,B3,B5,D1,D2,D3,D5,D6,E2; SKIP B9 (generated date is intended metadata), D7 (suggestions table already tracked/deferred), E3 (PATH append harmless), E4 (test-only formatting glue).

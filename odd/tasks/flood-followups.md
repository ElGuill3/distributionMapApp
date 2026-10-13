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
- F3 [S1] inline; pending — triage (explore task mv75t6qy-4-2cjn) then fix FIX items with tests

## Log
- L1: "vamos con las primeras 3 mejoras, las etiquetas de Sentinel lo dejaremos para despues para revisar si mejoraria o no"
- L2: Review finding texts are not retrievable (lineages burned); only locations survive, so an explorer reconstructs them from the reviewed commits.
- L3: Live vs spec diff on main 7fdcdfa: documented not served ['/api/water-gif-bbox', '/api/water-timeseries-bbox']; served not documented ['/api/docs', '/api/docs/openapi.yaml', '/api/flood-detection', '/api/flood-stats', '/api/local-stations']. matplotlib: no import outside tests/conftest; rasterio: only backend/floodmodel.

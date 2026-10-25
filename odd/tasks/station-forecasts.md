# Station forecasts in the app

Show the published river stage forecast for every station the model repo publishes, not only Boca del Cerro (BDCTB).
Source of the forecasts: `ElGuill3/tabasco-river-forecast`, branch `forecasts`, `<code lowercase>/latest.json` and `history/`, schema `bdctb-forecast/v2` (same for every station).
Mirror: Engram `odd/station-forecasts/tasks`.

## Specs

- **S1** (user, 2026-10-25) "vamos al menos con las mejores, igual bien justificado y todo eso para el documento de informe". The model repo now publishes BDCTB, MACTB (Macuspana), SAACP (Salto de Agua), PNVTB (Pueblo Nuevo) and TAPTB (Tapijulapa), chosen by the rule in its ODD Log L67.
- **S2** Each of the five stations shows its forecast in the app exactly as BDCTB does today:
  - the popup summary (at most 3 lines, with the NAMO wording of FV S8);
  - "Ver detalle" with the chart of 30 days of observed level plus h1/h3/h7, the q10–q90 band and markers on the modelled leads (FV S7, S9);
  - the neutral model ring only when the forecast is live and q50 ≥ that station's NAMO.
  Each station uses its own NAMO from its JSON (`namo_m`).
- **S3** The existing contracts hold:
  - `/api/v1/forecasts/bdctb` keeps working unchanged;
  - no forecast is requested at startup (L6 of the forecast-visualization feature) — a forecast is fetched only when its station popup or detail opens;
  - icon colours come only from the IPCET semáforo;
  - UI copy is in Spanish;
  - stations without a published forecast look and behave exactly as today.
- **S4** Only the published codes are accepted. Any other code answers 404 without contacting GitHub.

## Tasks

- [x] **T1** (S1–S4) Backend: forecast route for the published codes, reusing `forecast_feed` validation, with `/api/v1/forecasts/bdctb` unchanged. Frontend: generalise the BDCTB forecast popup, chart and ring to the published codes. Tests: backend, vitest and e2e. Route: gentle-ai-worker. Commit: e877ff7 (backend), 3425dd7 (frontend); see L4.

## Log

- **L1** (user, 2026-10-25) "vamos al menos con las mejores, igual bien justificado y todo eso para el documento de informe"
- **L2** The model repo's production run 40228024752 (2026-10-25) published `mactb/`, `saacp/`, `pnvtb/` and `taptb/` live, next to `bdctb/`, in the same schema. Each `station` field carries `code` and `name`.
- **L3** The worker found that the app's station markers come from local CONAGUA CSVs in `backend/data/stations`, which exist only for BDCTB and SPTTB and are downloaded at bootstrap. Adding those downloads would add startup work, so decision B was taken instead:
  - MACTB, SAACP, PNVTB and TAPTB get a small static catalogue entry (code, name, CONAGUA coordinates);
  - their colour comes from the IPCET semáforo;
  - their popup offers only the IPCET status and the forecast; the chart's observed series comes from IPCET `recent`;
  - CSV-backed historical actions are not offered for them;
  - BDCTB and SPTTB are unchanged.
- **L4** T1 done by the worker (tasks mvo8xt9c-5-6ue9, mvo99oqi-6-a0px, mvo9b8la-7-2t4j).
  - Results: backend 813 passed, 1 failed (the earlier Google FutureWarning preflight failure, also present before the change); vitest 336; tsc clean; e2e 36 (new: the MACTB popup).
  - **Slice boundary:** the branch holds about 1150 authored lines in two work-unit commits (backend e877ff7, frontend 3425dd7). It is reviewed and delivered as one PR because both commits form a single behaviour.


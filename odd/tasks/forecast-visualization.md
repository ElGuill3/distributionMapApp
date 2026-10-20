# Forecast visualization, first version for more rivers

Station icons take their colour from the official IPCET semáforo, and the river forecast also appears in the chart panel. Boca del Cerro (BDCTB) and San Pedro (SPTTB) are the stations on the map today; the design must extend to the other IPCET rivers as their models arrive. Model work lives in `ElGuill3/tabasco-river-forecast` (ODD `odd/tasks/usumacinta-forecast.md`, S8).

## Specs

- **S1** First version for more rivers: "crees que podamos mejorar la visualizacion del pronostico en la app? tipo como primera version para cuando incorporemos los demas rios?" Nothing may be hard-wired to BDCTB where a station code can be used instead.
- **S2** Blinking icon: "estaba pensando en que el icono titilee o parpadee de un color de acuerdo al nivel de alerta". Decision (L2): the colour comes from the **official IPCET semáforo** column of the daily table, never from the model. The icon shows the official state and its date and links to the IPCET source. Only states above normal blink, and blinking respects `prefers-reduced-motion`.
- **S3** Chart panel: "para el panel de prnosticos, se podria reutilizar el panel de grafico para que tambien se vea ahi". The existing Plotly chart panel shows, for a station with a forecast:
  - the recent observed IPCET levels as a solid line;
  - the forecast median as a dashed line, with the q10–q90 band shaded;
  - the official NAMO as a horizontal line.
  The existing forecast dialog stays.
- **S4** Model mark (L2): when the published forecast is in live mode and its median reaches the NAMO at any lead, the icon gets a separate, discreet mark (for example a dashed ring) labelled as a modelled forecast. It is never coloured as an alert. In GloFAS-only mode no mark is shown, because that mode has a 0.53 false-alarm rate at one day.

## Tasks

| ID | Specs | Route | Repo | Commit |
| --- | --- | --- | --- | --- |
| T1 | S2 | worker | tabasco-river-forecast: levels reader returns each station's semáforo state (colour and text) with fixture tests | river 29fb055 |
| T2 | S1 S2 S3 | worker | tabasco-river-forecast: operate publishes `ipcet/latest.json` (all stations: code, river, station, ayer, hoy, namo, semáforo, table date, last_modified) and recent observed levels per station; the v2 forecast schema stays unchanged | |
| T3 | S1 S2 S3 | worker | app backend: cached proxy for the semáforo and observed-level publications, using the forecast_feed pattern (deadline, disk cache) | |
| T4 | S2 S4 | worker | app frontend: marker colour and blink from the semáforo, model mark, legend note, accessibility | |
| T5 | S3 | worker | app frontend: forecast series in the chart panel, opened from the station popup | |
| T6 | S1–S4 | parent | docs, e2e, end-to-end check with real data, PRs | |

## Log

- **L1** User request (2026-10-19), verbatim: "Si, una duda, crees que podamos mejorar la visualizacion del pronostico en la app? tipo como primera version para cuando incorporemos los demas rios? estaba pensando en que el icono titilee o parpadee de un color de acuerdo al nivel de alerta, y para el panel de prnosticos, se podria reutilizar el panel de grafico para que tambien se vea ahi?"
- **L2** The parent pointed out the risk of colouring icons from the model: a blinking red icon at a public fair reads as an official alert, and GloFAS-only mode raised a false NAMO exceedance for 2026-10-22 that the live level corrected. It proposed taking the colour from the official IPCET semáforo and giving the model forecast a separate, discreet mark. User reply, verbatim: "si, me parece bien".
- **L3** Exploration found:
  - `levels.py` `_semaforo_column` already locates the semáforo column and its station bands, but `StationRow` carries no state.
  - The app map has two stations, BDCTB and SPTTB (`CONAGUA_HIDROS_STATIONS`), and both appear in the IPCET table (Usumacinta/Boca del Cerro, San Pedro/San Pedro).
  - The chart panel is Plotly with a date axis (`frontend/src/ts/ui/chart.ts`).
- **L4** T1 done (river repo `29fb055`, river ODD L56).
  - A survey of 638 images (8,568 station cells) found the official states NORMAL (green), A LA BAJA (grey), BAJO (brown), PREVENCION (yellow), ALERTA (red) and EMERGENCIA (purple). No orange cell was observed.
  - `StationRow.semaforo` takes the text when legible and falls back to the colour; it is None for S/D, empty or unknown cells.
  - Fixtures, checked by eye by the parent:
    - 2026-10-19: San Joaquín ALERTA, other 13 NORMAL.
    - 2026-10-14: Samaria A LA BAJA, Boca del Cerro PREVENCION, the rest NORMAL.
  - The CLI CSV is unchanged. 315 tests pass. Assess medium, review not due.

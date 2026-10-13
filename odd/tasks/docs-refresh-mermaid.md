# Documentation refresh with Mermaid diagrams

Audit README.md and README.en.md against the current code, fix stale or wrong claims, and replace ASCII diagrams with Mermaid diagrams that render on GitHub.
Branch `docs/refresh-mermaid`. Both languages change together in every commit.

## Specs
- S1: "hechale un vistazo a la documentacion, para verificar que este actualizada" — every factual claim in README.md and README.en.md matches the code (audit mv5zre9i-7-mj7p); the two READMEs carry the same content.
- S2: "creo que hay ciertas cosas que deberian ser un diagrama mermaid, para que lo cambies porfa" — ASCII diagrams (architecture, frontend tree) become Mermaid.
- S3: "si ves que se puede agregar algun diagrama que ilustre el funcionamiento de algo agregalo" — add Mermaid diagrams where they explain behavior (launcher startup, GIF request with SSE, modes, station bootstrap).
- S4: "si se pueden agregar diagramas mermaid a la doc y que se vean en github no?" — every Mermaid block must parse and render (validated with mermaid-cli before commit).

## Tasks
- D1 [S1-S4] inline; done; architecture flowchart, launcher startup flow, forecast stack topology, station download flow, GIF request sequence (es+en); scraper daemon text corrected (runner.py not started, HTTPS first, FTP fallback); cache-hit note corrected (time series still queried); 10/10 diagrams rendered with mermaid-cli 11
- D2 [S1-S4] inline; pending (frontend: module graph replacing ASCII tree, modes incl. flood detection, module notes)
- D3 [S1] inline; pending (reference: variables, requirements/deps, env table, stations, endpoints, dev notes, deployment, future work, credits)

## Log
- L1: "Perfecto, ahora porfa hechale un vistazo a la documentacion, para verificar que este actualizada, igual creo que hay ciertas cosas que deberian ser un diagrama mermaid, para que lo cambies porfa, igual si ves que se puede agregar algun diagrama que ilustre el funcionamiento de algo agregalo, si se pueden agregar diagramas mermaid a la doc y que se vean en github no?"
- L2: Audit mv5zre9i-7-mj7p: scraper daemon never started (runner.py unreferenced; one-shot bootstrap via HTTPS, FTP fallback); no water variable or /api/water-gif-bbox; flood-detection mode and /api/flood-detection, /api/flood-stats, /api/local-stations, /api/v1/forecasts/bdctb undocumented; station param needs suffixed ids; GIF cleanup every 600 s (max age 60 min); CONAGUA_CLIMAS_STATIONS default BDCTB,SPTTB; frontend tree stale; gunicorn/Nginx section conflicts with app-only local decision; Docker/container remnants.

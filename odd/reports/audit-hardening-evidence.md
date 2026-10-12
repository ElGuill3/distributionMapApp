# Audit hardening: evidence and boundaries

Scope: the authorized correctness/security corrections and same-repository layout work.
This is a record of observed evidence, not a claim that production providers or every dependency are secure.

## Confirmed corrections

| Area | Observed public proof | Closing units |
| --- | --- | --- |
| Export containment | Traversal, absolute paths, non-GIF paths and resolved symlink escapes return HTTP 400 without changing owned files; valid absent GIFs retain HTTP 404. Real local ZIP entries, CSV, GIF bytes and metadata are checked with synthetic inputs. | `0bdb7e6` |
| Browser text injection | Hostile station/legend text is escaped; the isolated actual-browser probe inserted no executable image/event attributes and preserved normal actions. | `e9eb01c` |
| SSE ownership and bounds | Replacement owners survive old-stream closure; completed-task retention, bounded registrations/messages and concurrent producers/consumers are covered. State remains process-local. | `f4d2cc0`, `3ecc656`, `4cfaa05`, `e3220be` |
| Async UI/resource ownership | Superseded results cannot publish stale state/events; current failures remain visible; replacement/disposal releases object URLs and failed candidates leave prior frames intact. | T5 units recorded in the task document |
| API/runtime limits | Finite ratio/bbox/date validation, season/leap-year behavior, configured quotas and frontend/server limits are pinned through public requests and UI actions. | T3/T7 units recorded in the task document |
| Import/startup effects | Cold import performs no provider initialization, directory preparation or cleanup start; explicit/lazy initialization preserves once-only ownership and controlled failure/retry behavior. | `4007b68` |
| Palette SDK compatibility | Real Matplotlib/rasterio render default and viridis RGBA PNGs from a synthetic GeoTIFF, with exact pixels/nodata transparency and existing cache/URL behavior. | `a9b76b5` |
| Package/layout contracts | Canonical backend modules share blueprint/schema/service objects; public URLs, launchers, data roots and frontend output paths are preserved. | T10/T11 units recorded in the task document |

## Conditional findings: dispositions

### Palette-shaped traversal: no reproduced vulnerability, no speculative fix

The public real-SDK regression sends `../../palette_escape_probe` and observes the existing generic HTTP 500 with identical before/after file hashes and no escaped output.
`backend/gee/flood_risk.py` resolves the colormap before constructing its output filename.
The tested installed registry contains 182 names and no path-shaped names; the application does not expose custom colormap registration.

This is an ordering/registry boundary, not a new structural containment guard.
Revisit the boundary if custom palette registration is introduced. No new schema restriction or rejection contract was added here.

### Browser resources/CDNs: operational limits, not an invented advisory

The actual browser suite exercises rendered runtime context, application feedback and drawing/generation failure paths with synthetic APIs.
Lucide is served from local `/static/vendor/lucide/`; other template resources still require CDN access.
Only the existing Leaflet resources have SRI; this work does not add CSP, comprehensive SRI or exact pinning of the Scalar caret range.
No specific advisory was identified by the original conditional findings, so absence of those controls is not presented as a reproduced exploit or as proof of safety.

A separate supply-chain/header policy would need its own compatibility criteria. CDN availability and compromise were not certified by the browser pass.

### Dependency/manifest observations: no blind upgrades

Leaflet-draw and Plotly are delivered by the template CDNs rather than npm.
JSZip is a development/build dependency in npm and is resolved by the browser import map at runtime.
The launcher expects an installed checkout/build toolchain, not an `npm --omit=dev` production bundle.
The confirmed Matplotlib compatibility failure was reproduced and fixed; this is not an exhaustive npm/Python advisory audit.

### Scripts-only wheel: intentional checkout execution

The Python wheel packages `scripts`; `distribution-map` locates and runs an application checkout.
It is not a standalone wheel containing the Flask application, templates, static assets and data.
Root `app.py`, `config.py`, `extensions.py`, npm manifests and launch/build entrypoints remain canonical.

### Preflight/deployment limits

Preflight checks the local Python/Node/build/port/bootstrap prerequisites; it does not certify every CDN or vendor file.
SSE queues and the default rate-limit store remain in-process. Multiple workers/replicas need a shared-state design outside this change.
The documented single-worker/threaded deployment command was not exercised because Gunicorn is not installed.

## Observed proof and preserved debt

- Frontend source and test reorganization retained all **249 Vitest cases**.
- Default Python discovery and independent execution retained all **649 tests**, including the real local SDK and public build fixtures.
- The relocated browser suite passed all **13 actual Chromium cases** using the prepared project-local portable browser.
- All **40 published JS/CSS paths and hashes** were unchanged by the source move. Source-map input paths intentionally follow the new frontend source location.
- High-risk work units received independent verification in addition to their own checks and native review. Every closed implementation unit has its own commit and exact native acknowledgement.
- Baseline source Ruff debt remains **116 findings**, test Ruff debt **70**, and source formatting reports **17 files that would change**. These are not clean-quality claims; newly introduced findings were corrected before closure.
- The unchanged Flask-Limiter in-memory-storage warning remains an operational warning.

## Not claimed

No real Earth Engine initialization, cloud processing/download, scraper execution, production deployment, multiworker SSE support, push, pull request or merge was performed.
Local PNG and ZIP writers were exercised with synthetic owned inputs; a complete successful cloud-generation-to-browser-download flow is not certified.
No unrelated temporary files, user browser profiles or real application data were deleted.

Canonical requirements, failed checks, causal comparisons, commits and review acknowledgements: [task document](../tasks/audit-hardening-layout.md).

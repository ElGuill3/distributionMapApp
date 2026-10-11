# Audit hardening and repository organization
Branch: `fix/audit-hardening-layout`; baseline: `0f000c592e0edd3e831159b50561c7282a803271`. One repository and same-origin Flask runtime.
Delivery: feature-branch-chain, individual work-unit commits and explicit RDD per unit; target <=400 authored additions+deletions with tests/docs. Runners: `.venv/bin/python -m pytest`, npm quality/tests/build.

## Specs
S1. "avanza con la correccion de las vulnerabilidades y luego la organizacion"
S2. "Bien, si, con separacion no me refiera a que cada uno tenga un repo, mas bien me referia a organizar mejor las carpetas, justo como lo planteas"
S3. "recuerda hacer commit y RDD por cada unidad de trabajo de 400 lineas de codigo"
S4. "te autorizo a tomar las deciciones pertinenete con evidencia"
S5. "continua con unidades encadenadas hasta cerrar todo"
S6. "si durante las correcciones/verificaciones encuentras deuda adicional, te autorizo para reproducir -> corregir de acuerdo a tu criterio"

## Tasks
- T1 [S1,S3,S4,S6] inline; in_progress; confine export ZIP inputs to permitted GIF files; RED: 6 failed/3 passed + 2 verifier regressions; GREEN: 47 focused/272 full Python tests; independent verification: passed after bounded correction; RDD/commit: pending.
- T2 [S1,S3,S4] inline; pending; safely render external station/legend text and validate browser resource trust boundaries; commit: pending.
- T3 [S1,S3,S4] inline; pending; reproduce and fix numeric/bbox/date-mode API validation and error contracts; commit: pending.
- T4 [S1,S3,S4] inline; pending; bound and clean up progress queue lifecycle with isolated disconnect/concurrency checks; commit: pending.
- T5 [S1,S3,S4] inline; pending; reproduce and fix stale frontend generation/modal/player lifecycle; commit: pending.
- T6 [S1,S3,S4] inline; pending; remove stale generated-module unit-test dependence and make E2E scenarios exercise actual behavior; commit: pending.
- T7 [S1,S3,S4] inline; pending; reconcile configurable limits and shared client/server rules with tests; commit: pending.
- T8 [S1,S3,S4] inline; pending; isolate application startup side effects; validate conditional palette/dependency findings before changing them; commit: pending.
- T9 [S1,S2,S3,S4] inline; pending; separate authored frontend assets, generated output and backend runtime artifacts; preserve public URLs; commit: pending.
- T10 [S1,S2,S3,S4] inline; pending; organize backend into an explicit package and update imports/launchers/tests coherently; commit: pending.
- T11 [S1,S2,S3,S4] inline; pending; organize frontend sources/tooling/tests in frontend/ and backend tests in backend/; commit: pending.
- T12 [S1,S2,S3,S4,S5] inline; pending; final cross-stack functional checks, documentation and remaining-evidence disposition; commit: pending.

## Log
L1. User authorization verbatim: "ok, el orden que propones me parece correcto, avanza con la correccion de las vulnerabilidades y luego la organizacion, te lo encargo, te autorizo a tomar las deciciones pertinenete con evidencia, recuerda hacer commit y RDD por cada unidad de trabajo de 400 lineas de codigo, continua con unidades encadenadas hasta cerrar todo"
L2. Current source audit and three parallel audits completed at main 0f000c5. Confirmed source issue: export route joins unconstrained client paths to STATIC_DIR and service writes them into ZIP without resolved containment. Other findings distinguish source observations from untested runtime hypotheses; validate each before changing it. Scripts-only wheel is intentional checkout execution, not an established defect; prior 166 frontend passes remain valid.
L3. Planning assumptions: keep uv run distribution-map, same-origin HTTP API and existing usable data; no separate repos/services/framework migration. No push, PR, merge or deployment authorized by this request. Public review candidate is one commit against the preceding unit, never accumulated branch. User explicitly requests review for every unit even when reviewDue=false; human/provider consent remains separate. Initial forecast roughly 2500-4000 authored lines excluding pure rename content; units will be split by coherent behavior if needed, never by code-golf. Existing user-selected feature-branch-chain retained; no PRs created.
L4. Route: inline because background writer policy is off and no context backstop fired. Independent verifier mandatory for security/concurrency and native high/unassessable risk. RDD never replaces functional checks. Synthetic tests only; no real secrets, downloads, data rewrites, app restarts or service requests needed for T1.
L5. T1 acceptance decision: accept existing gifs/name.gif and /static/gifs/name.gif; reject traversal, absolute paths, non-GIF paths and resolved symlink escapes with generic HTTP400, preserving existing404 for absent valid GIF. Validate again inside ZIP service so internal callers cannot bypass the route. Test the public Flask route against isolated synthetic files and assert rejected requests leave file bytes unchanged; regression-check valid ZIP entries/contents and metadata.
L6. Additional user authorization verbatim: "si durante las correcciones/verificaciones encuentras deuda adicional, te autorizo para reproducir -> corregir de acuerdo a tu criterio". New demonstrable debt may add linked S6 tasks; do not treat preferences or unvalidated hypotheses as defects.
L7. T1 RED: `.venv/bin/python -m pytest tests/test_export_path_security.py -q --basetemp=.cache/audit-t1-red` exit1, 6failed/3passed. Traversal/absolute/non-GIF/symlink paths yielded200; backslash path yielded404 instead of400. Valid relative/prefixed GIF and missing valid GIF regressions passed. All payloads/files synthetic; no live data or secrets accessed.
L8. T1 GREEN: focused route/service/security/API-doc tests45pass; full Python first269pass1fail (negative launcher-root test assumes scratch outside checkout). S6 reproduces that fixture dependency; isolated synthetic checkout detection without changing launcher. Corrected full suite270pass with1knownLimiterwarning. Changed route/service/newtest/launcher-test Ruff passes; gee/schemas.py retains3baseline E501 lines outside modified field description. Native assess unassessable because untracked scope not yet declared, conservative independent verifier required. No test runner timeout or source retry beyond one fixture correction.
L9. Independent verifier found2rejection-contract blockers: existing GIF-named directory returned404, and missing-first masked later forbidden path. Durable public-route/service regression tests observed RED2fail; complete-list validation and nonfile rejection fixed both. Scoped independent recheck2pass confirms blockers closed, no privatebytes/filechanges. Final47focused and272fullPython pass; knownLimiterwarning persists. Removed unrelated OpenAPI forecast-description rewrap. Candidate including initial tracker/newtests remains below400changedlines. RDD/commit next.

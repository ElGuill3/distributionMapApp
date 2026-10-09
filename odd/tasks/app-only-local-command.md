# App-only local command

## Intent and scope
`uv run distribution-map` builds TypeScript frontend and starts Flask serving app foreground at 127.0.0.1:5000, without Docker/model repo/API/worker. Deferred scripts/run_local_forecast_stack.py preserved; existing app/Earth Engine prerequisites remain. No automatic installs or provider calls. Model repo excluded.

## Constraints and delivery
Initial clean feat/bdctb-local-forecast-final at b73122b. User now explicitly authorized commits and non-force push to existing origin/feat/bdctb-local-forecast-final so the next session starts clean; parent owns staging/commits/push. No PR/merge authorization; native review remains unavailable and is NOT approved. No credentials or local environment files in delivery. User selected feature-branch-chain for future review slices. Slice proposal: clean build driver + contract, then app-only runtime/tests/docs + Docker removal. Initial 300–380 line forecast exceeded (~898 before lifecycle corrections); do not shrink tests/docs to budget.
Sequential delegated writers and independent verifiers (multi-file/verification triggers). RDD globally on.

## Tasks
- [x] T1 outcome and work-unit commits verified: build fa93cde01961fb4cd71f2757c91016cabf74c38d; app/entry point/tests/docs a9f89ac4a5099e1f5f0a6fc5acbae72cfbad96c3.
- [x] T2 Docker removal and functional checks verified, committed with app unit a9f89ac4a5099e1f5f0a6fc5acbae72cfbad96c3. Native review unavailable (not an approval); delivery handled by T3.
- [x] T3 source publication verified: cohesive build/app units committed and non-force pushed to existing branch; git ls-remote returned a9f89ac4a5099e1f5f0a6fc5acbae72cfbad96c3 matching local HEAD. Sanitized tracking snapshots archived in a follow-up documentation commit; parent verifies final clean tree and remote after that push.

## Evidence
User explicitly selected B authorizing clean scripts/build-typescript.mjs and tests/test_frontend_build_contract.py adaptation without Docker assertions. package.json build script updated and CRLF normalized to LF to resolve diff whitespace failure.
Test-first observed by writers: missing launcher/build contract RED, then GREEN. Independent verifier found startup interruption windows and handshake flaw; corrective deterministic RED/GREEN added for SIGTERM during startup, resistant descendant escalation, pre-spawn/post-registration abort gates, and no build after dependency abort. Final independent spot check: 38 focused tests pass, offline CLI help pass, git diff --check pass; no remaining inspected candidate blocker.
Current recheck: 18 focused Python tests pass and 166 frontend tests pass; forecast tests skip at the Earth Engine auth boundary. scrapers/runner.py Ruff baseline remains 12 unchanged findings. Historical full Python suite from a prior state: 237 passed, one Flask-Limiter in-memory warning; not the current count. Independent frontend checks before Python-only corrections: 19 files /166 tests pass; actual clean npm build passed. Edited Python Ruff lint/format pass.

## Known baseline/check limitations
npm quality:ts fails from 3 unused-variable ESLint errors in unchanged src/ts/main.ts and existing formatting debt. scrapers/runner.py Ruff has 12 baseline lint findings, reproduced from HEAD; only comment changed. Not fixed (outside scope).
uv run pytest could not spawn pytest; existing .venv/bin/python -m pytest used successfully offline. No independent live browser/HTTP/Earth Engine calls performed; user confirmed authentication and reports app running. Actual feature behavior beyond startup remains unverified.
Native inspect included four untracked source/test files and excluded this task doc. START returned candidate-owner-parent-chmod-ineffective: /mnt/c candidate parent filesystem does not honor POSIX chmod. lineage_created=false, mutation_performed=false; no review approval/lineage. Fresh publication preflight for committed build range was blocked by native-start-retained-selection-candidate-mismatch without mutation. Fresh app work-unit inspect/ordinary START again returned candidate-owner-parent-chmod-ineffective with lineage_created=false and mutation_performed=false. No reset/recovery or review approval. Native assess unavailable/unassessable; unavailability is not approval. Separate independent verification fulfilled conservative plan.

## Next
User-confirmed: Earth Engine gcloud authentication (cloud-platform-only scope) and callback succeeded; user reports the app now running via uv run distribution-map. Source units fa93cde and a9f89ac are published to origin/feat/bdctb-local-forecast-final, verified by remote ref. No PR/merge. Task continuity snapshots are included in a follow-up docs commit; final docs commit identity and remote/clean-state check are retained in Engram. To enable native review later, resolve Git common-directory filesystem metadata support through separately authorized environment work; then fresh inspect/START for the current candidate. Task mirror synchronized.

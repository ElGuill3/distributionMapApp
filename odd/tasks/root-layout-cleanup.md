# Root layout cleanup

Move remaining runtime roots out of the repository root into `backend/` and `frontend/`, and untrack tool artifacts.
Branch `refactor/root-layout-cleanup`. Root keeps project manifests, lockfiles, tool configs, README files, `.env.example`, git files and `odd/`.

## Specs
- S1 (group 2, approved: "si, vamos con 2 y 4"): move `app.py`, `config.py`, `extensions.py`, `app_preflight.py` to `backend/`.
- S2 (group 2): move `templates/` and `static/` to `frontend/` without changing public URLs (`/static/...`, `/`, `/api/docs`, `/api/docs/openapi.yaml`).
- S3 (group 2): move `openapi.yaml` to `backend/`.
- S4 (group 2): split `scripts/`: `build-typescript.mjs` to `frontend/`, the rest to `backend/`; update the command in `pyproject.toml`.
- S5 (group 2): move `data/mapa_riesgo` to `backend/data/`; runtime data paths must resolve to the moved location (a wrong path must not silently start the app against missing data).
- S6 (group 4): untrack `test-results/.last-run.json`, `.codegraph/` and `.engram/` and add them to `.gitignore`.
- S7 (groups 1 and 3, user: "lo dejamos si veo bien dejarlos siempre que sea lo normal"): `pyproject.toml`, `uv.lock`, `.gitignore`, `.gitattributes`, `README*`, `.env.example` and JS/Python tool configs stay at the root.
- S8: `uv run distribution-map` keeps working from the repository root; root `.env` keeps being loaded; every unit is a separate small commit with the Python and frontend suites passing.

## Tasks
- T1 [S6] inline; done; commit `c4e61a9`; git check-ignore confirms all three paths ignored; local files kept
- T2 [S5,S8] inline; done; commit `98ae24e`; RED 15 data-path failures, GREEN 26 focused, full Python 649 PASS (--basetemp .cache); real config: 16 FHI tifs and 4 local stations resolve under backend/data
- T3 [S3,S8] inline; done; commit `6434f1a`; RED 6 docs-test failures, GREEN 10 focused, full Python 649 PASS; independent verify mv5wor92-2-i3f3 S3 met; RDD high, reliability lens approved, acknowledged review-3a43f6751d77cd34
- T4 [S2,S8] inline; done; commit `23293c7`; native review explicitly skipped by user (L5); RED 4 fail+107 errors, GREEN 126 focused; full Python 649, Vitest 249, quality 0, build ok, 13 real-browser e2e PASS; public /static URLs unchanged; static/vendor+assets+templates pure renames; verify mv5wy7o8-3-m6pa found stale convert_lf.py path -> fixed with RED/GREEN test_convert_lf.py; app.py/config.py are CRLF (sed anchors with $ do not match)
- T5 [S4,S8] inline; done; commit `2df4a68`; build-typescript.mjs -> frontend/scripts/ (root resolves two levels up); RED 10 fail, GREEN 21 focused; build ok, full Python 650, Vitest 249, quality 0; RDD medium, no review due
- T6 [S1,S8] inline; done; commit `0154d3e`; app/config/extensions/app_preflight -> backend/, BASE_DIR = repo root (resolve), flask --app backend.app, preflight backend.app_preflight, quality scope backend/; RED 9 fail, GREEN 80 focused; full Python 650, Vitest 249, quality 0, 13 e2e, 15 flask routes, root .env loads; lint no new errors (11 I001 fixed); RDD high, risk+reliability approved+acknowledged review-aa515623c115672a; independent verify mv5xiu4l-5-np4g S1/S8 met; added test_backend_root_modules.py
- T7 [S4,S8] inline; done; commit `6e93d9a`; Python scripts -> backend/scripts/, quality -> backend/scripts/quality/, entry backend.scripts.run_app:main, wheel only-include backend/__init__.py+backend/scripts (10 files, scripts-only contract kept); RED 5 collection errors, GREEN 73 focused; full Python 651, Vitest 249, quality 0, 13 e2e, lint 117 = baseline; RDD high, risk+reliability approved+acknowledged review-a1b11eb8d84a349d (advisories: partial backend in wheel by design; --merge path untested -> verifier exercised it on isolated copy); independent verify mv5yar8n-6-c76p S4/S8 met; added test_scripts_relocation.py
- T8 [S1-S8] inline; done; commit `38e1a02` (RDD passive, structural readback); README trees (es/en) rewritten for root manifests + backend/ + frontend/, stale static/scripts refs fixed, audit report wheel note; real `uv run distribution-map` (new code): ready in 12s, 4 stations refreshed, / /api/docs /api/docs/openapi.yaml /static/styles.css /static/main.js vendor+assets /api/local-stations all 200, missing static 404, vendor bytes equal; stopped cleanly with SIGINT

## Log
- L1: "No se si recuerdes que te pregunte sobre la organizacion de carpetas y si era posible dejar solo las carpetas de backend y frontend o si son necesarios los archivos que estan fuera, podemos revisarlo?"
- L2: Proposal grouped root items: 1 must stay, 2 movable with code changes, 3 tool configs (recommended stay), 4 artifacts to untrack.
- L3: "si, vamos con 2 y 4, lo dejamos si veo bien dejarlos siempre que sea lo normal"
- L4: Explorer map mv5w9shl-1-zfer: key risks config.__file__ anchoring BASE_DIR, bare load_dotenv(), relative template_folder, `--app app`, wheel `packages=["scripts"]`, root-anchored .gitignore static patterns.
- L5: T4 commit 23293c7: native review assess saw 3444 pure renames as ~73k lines and inspect only offered the whole branch from main. User chose "Dejar T4 sin revisión externa"; evidence is full suites, 13 e2e and independent verify mv5wy7o8-3-m6pa (finding fixed).
- L6: T6 verifier first attempt crashed with ENOSPC: /tmp is a 5.9G tmpfs and verifier scratch copied .cache (13G); removed own verifier scratch copies, relaunched with no-.cache constraint.
- L7: Port 5000 was held by a user-started instance from 17:31 running pre-move code (served 404/500 after the move). User chose "Detenela vos y probá"; launcher hung in futex after SIGINT/SIGTERM and was stopped with SIGKILL (flock released on exit); new-code launch then passed.

# WSL Google Cloud CLI setup

## Intent and authorization
User authorized user-local SDK install and Windows browser preparation. No sudo, app/.venv changes, auth initiation or credential reads. Preserve feature source work.

## Tasks/routing
- [x] G1: Official Linux archive SHA verified and SDK installed at ~/.local/share/google-cloud-sdk. Version588.0.0; reporting off, no shell profile edits.
- [x] G2: Executable ~/.local/bin/gcloud dispatches official SDK with encoded PowerShell HTTP(S) browser opener. Independent mock and CLI verification complete.
Parent performed bounded home environment setup, independent gentle-ai-verify checked commands. No meaningful vendor-install RED; wrapper post-implementation mocks used, no pre-implementation RED observed. Home changes outside Git candidate; no staging/commits/push performed in setup.

## Evidence
Official SHA25673b6678401811a8a1b8d0ce29e043834308d9263ae6d9577c5aadc55621cd7d3 matched download. Installer --quiet --path-update=false --command-completion=false --usage-reporting=false passed.
Independent gcloud --version and ADC login help pass; uv offline EE auth help and app help pass; git diff --check pass. EE adapter using project .venv resolves ~/.local/bin/gcloud.
Wrapper mock verifies URL &/apostrophe preservation, invalid scheme rejection, timeout/nonzero generic errors and unchanged CLI forwarding. Parent env unchanged; three intentional child overrides: BROWSER, usage-reporting off, update-check off. Existing DISPLAY/WAYLAND markers available. No actual auth/browser/callback executed this setup.
Verifier system-Python EE import attempt failed missing _cffi_backend; reran correctly with .venv Python and resolved wrapper. Not a project dependency failure.
User-confirmed outcome after setup: authentication was re-attempted limited to the cloud-platform scope only, and the user confirms gcloud consent, callback, and saved-token flow succeeded. User reports the app now running. No writer-run live auth, browser, or callback was executed; outcome is user-reported, with no hashes or evidence invented.

## Limits and next
Google Cloud callback also handles one request; official gcloud mode is supported alternative, not guaranteed cure for unrelated first request. OAuth state/PKCE unchanged; no auth internals patched. Native review remains unavailable and NOT approved.
Human next command: uv run earthengine authenticate --auth_mode=gcloud. Complete Google consent in Windows browser, await saved-token confirmation, then uv run distribution-map. Auth and callback are user-confirmed successful after cloud-platform-only scope limiting; app running is user-reported. Project inundaciones-app already set; native review remains unverified. No secret or OAuth URLs recorded.

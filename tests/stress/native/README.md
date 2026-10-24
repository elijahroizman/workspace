# Native-side stress tests

Playwright scripts that fake the Tauri backend (`window.__TAURI_INTERNALS__`) to test what the app does around the file system. Run them against a test build, with Playwright available (`npm i --no-save playwright`):

```sh
VITE_TEST_HOOKS=1 npx vite build && npx vite preview --port 4173 &
node tests/stress/native/save-conflict.mjs http://localhost:4173/ chromium
node tests/stress/native/save-conflict.mjs http://localhost:4173/ webkit
```

- `save-conflict.mjs`: a file another app changed after Writan opened it isn't autosaved over, and Save asks before replacing it.

The Rust side (atomic saves, read-only files, symlinks, version history of outside changes) is covered by `cargo test` in `src-tauri`.

- `pdf-unchanged.mjs`: unchanged PDF saves preserve the original bytes, undo restores those bytes, edits persist, and repeated clean saves preserve the saved revision. Fetch the signed GPO PDF using `../corpus/manifest.tsv` and serve it at `/dev-samples/us-budget-2025-appendix.pdf`:

```sh
node tests/stress/native/pdf-unchanged.mjs http://localhost:4173/ chromium
node tests/stress/native/pdf-unchanged.mjs http://localhost:4173/ webkit
pdfsig /tmp/writan-pdf-chromium-unchanged.pdf
```

The scripts use the repository's documented Playwright workflow on bbb. Browser plugin not available. The PDF script writes its saved revisions and screenshot under `/tmp` on the test host.

`files::tests::partial_write_failure_keeps_original_and_removes_temp` injects a full-disk error after a partial write. It runs without mounting a filesystem. To test real ENOSPC, provide an isolated tiny filesystem in `WRITAN_FULL_DIR` and run the ignored `full_disk_keeps_the_original_and_no_scraps` test. The `unshare` recipe in its source requires a host that permits user namespace mappings and mounts.

On Linux, `python3 tests/stress/native/desktop-open.py` checks the launcher template through GIO using a harmless argument recorder. It creates two sample Markdown files, including names with spaces and Unicode, and verifies that both are forwarded in one launch. It does not launch or install Writan.

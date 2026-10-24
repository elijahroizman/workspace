# Native-side stress tests

Playwright scripts that fake the Tauri backend (`window.__TAURI_INTERNALS__`) to test what the app does around the file system. Run them against a test build, with Playwright available (`npm i --no-save playwright`):

```sh
VITE_TEST_HOOKS=1 npx vite build && npx vite preview --port 4173 &
node tests/stress/native/save-conflict.mjs http://localhost:4173/ chromium
node tests/stress/native/save-conflict.mjs http://localhost:4173/ webkit
```

- `save-conflict.mjs`: a file another app changed after Writan opened it isn't autosaved over, and Save asks before replacing it.

The Rust side (atomic saves, read-only files, symlinks, version history of outside changes) is covered by `cargo test` in `src-tauri`.

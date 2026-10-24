# Writan stress regression suite

This suite began on 2026-10-24. Tests target data loss first, then malformed inputs and visual fidelity. No release was made. Reports distinguish baseline observations, verified fixes, open findings, and work that needs native hardware.

Start with the severity-sorted findings in [BUGS.md](BUGS.md) and the [final verification](VERIFICATION.md). Detailed evidence and reproduction commands are in:

- [Native saves and PDF](BUGS-native.md), with [browser checks](native/README.md).
- [Office compiler and editing engines](BUGS-core.md).
- [Editors and shell](BUGS-ui.md).
- [Real document corpus](BUGS-corpus.md), with [fetch and test instructions](corpus/README.md). This is the original baseline report; the consolidated list records subsequent fixes.
- [Corpus fix verification](FIXES-corpus.md).

Small reproductions are committed under `samples/`. Environment-dependent cases create their own files in Rust tests or embed a fake filesystem in a browser script. Large or third-party samples have generator scripts or a URL and SHA-256 in `corpus/manifest.tsv`. The fetcher verifies those hashes. Full corpus originals and reference renders stay on bbb rather than entering the repository without redistribution permission.

## Run the checks

The native test workload runs locally. Keep it sequential on the smaller machine:

```sh
cargo test --manifest-path src-tauri/Cargo.toml -- --test-threads=1
cargo clippy --manifest-path src-tauri/Cargo.toml --all-targets -- -D warnings
```

Office engine and browser workloads run on bbb. Its Node is at `~/.local/node24/bin`; add that and `~/.cargo/bin` to PATH. Playwright and its browsers are already installed under `~/shots/node_modules`. Use an isolated rsynced checkout, with `playwright` and `playwright-core` linked into its `node_modules`. Follow the component reports for exact commands and fixtures.

```sh
cd crates && cargo test --workspace
cd ..
node scripts/engine.mjs --force
VITE_TEST_HOOKS=1 npm run build
npm run typecheck
npx vite preview --port 4173 --strictPort
```

Run the browser scripts against that server from another shell. The native scripts fake IPC for save behavior; the PDF script uses the real PDF worker. The corpus scripts compare ZIP parts, formula caches, signature validation, text, page counts, and reference renders. Opening without an exception is not a fidelity pass.

## Coverage limits

Chromium and WebKit tests exercise browser builds. They do not establish macOS Dock/logout behavior, Windows locks/file associations, actual cloud sync, physical display configurations, or an installer upgrade. Tests did not modify updater feeds or package repositories. Full-disk cleanup has a deterministic partial-write test; a real mounted-full-filesystem test remains ignored because this host disallows the required namespace mount. Unsupported rendering and crash recovery remain explicit findings, not passes.

When copying sources from a machine with an earlier clock, refresh Rust source mtimes on the build host before invoking Cargo. The engine script normally uses mtimes to skip builds, so use `--force` for the final regression build and verify Cargo actually recompiles the changed crates. This pass observed clock skew between the local host and bbb.

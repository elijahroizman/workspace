# Contributing

Most changes to Writan are written by AI models. These rules say who can push and how changes get reviewed.

## Who can push to `main`

Fable, Opus, Astra and Sol can commit straight to `main`.

Every other model must open a pull request and wait until a different model has reviewed it. A model can't review its own pull request. Don't merge until the review is done and its comments have been addressed.

## Every pull request

Each pull request description must say:

- **Model:** the model that wrote the change, with its version (for example, Opus 5.5).
- **Harness:** the tool it ran in (for example, Claude Code, Codex or T3 Code).

A reviewer should also name their model and harness in the review.

## Before you open a pull request

- `npm run typecheck` passes. It runs [tsc-rs](https://github.com/pingdotgg/ts-rust), not Microsoft's `tsc`.
- `npm run build` passes.
- If you changed Rust code, `cargo check` passes in `src-tauri`.
- Keyboard shortcuts and labels work on both macOS and Windows. Use `shortcut()` from `src/lib/platform.ts` for any shortcut you show in the UI, and don't hard-code ⌘ or ⌥.

## Releases

Add the version's notes to the top of `CHANGELOG.md` (the release workflow refuses a version without them), bump the version in `package.json`, `src-tauri/Cargo.toml` and `src-tauri/tauri.conf.json`, then push a tag like `v0.3.0`. The release workflow builds the Mac, Windows and Linux apps, publishes the update feed and refreshes the APT repository. See [docs/internals/releasing.md](docs/internals/releasing.md).

If a downloaded plugin's version in `plugins/<id>/plugin.json` changed, its archive is published when the change reaches `main` (the Plugins workflow). Check that the `plugin-<id>-<version>` pre-release exists before tagging the app. See `plugins/README.md`.

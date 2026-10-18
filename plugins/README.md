# Optional plugins

Each folder here is a plugin that adds a file type to Workspace without being part of the app
itself. A plugin is listed in `src/plugins/catalog.ts` and its editor follows the contract in
`src/plugins/api.ts`: an ES module that exports `apiVersion` and `mount(element, context)`, renders
into the element with whatever it likes (it brings its own React), and hands back `getBytes()`,
`destroy()` and optional find, zoom, print and theme hooks.

## Bundled or downloaded

- **Small (under about 1 MB): bundled.** Set `source: { type: 'bundled' }` in the catalog and
  `"bundled": true` in its `plugin.json`, and add its build to the `plugins:bundled` script (the
  dev server serves it from there). The app's build builds it into `plugins/<id>/dist` and copies
  that to `/plugins/<id>/`, so it comes with every install and turning it on is instant. EPUB is
  one.
- **Bigger: downloaded.** Excalidraw is 16 MB with its fonts, so it's `source: { type: 'download' }`.
  The app fetches `plugin-<id>-<version>/<id>-<version>.zip` from this repository's releases, checks
  its `.sig` against the updater's public key, unpacks it into its data folder and loads it through
  the `wsplugin:` scheme (`src-tauri/src/plugins.rs`).

## Making a downloaded plugin

1. `plugins/<id>/plugin.json`: `id`, `version` and `size` (the zip's size in bytes, shown before
   downloading). Bump `version` whenever the plugin changes: installed copies download a version
   only once.
2. `plugins/<id>/vite.config.ts`: builds `index.js` and its files into `plugins/<id>/dist`, plus a
   `manifest.json` with the same id and version. Copy `excalidraw/vite.config.ts`.
3. Add it to `PLUGIN_PACKAGES` in `scripts/licenses.mjs` so its licenses show in Settings.
4. `npm run plugins` (or `npx vite build --config plugins/<id>/vite.config.ts`). The dev server and
   `vite preview` serve the result at `/plugins/<id>/`, and the browser build and `tauri dev` load
   it from there.
5. To publish, push the tag `plugin-<id>-<version>`. The Plugins workflow zips and signs it
   (`scripts/pack-plugin.mjs`) and attaches it to a pre-release of that name.

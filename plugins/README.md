# Plugin authoring guide

Each folder here is a plugin that adds a file type to Workspace without being part of the app itself. A plugin is listed in `src/plugins/catalog.ts` and its editor follows the contract in `src/plugins/api.ts`: an ES module that exports `apiVersion` and `mount(element, context)`, renders into the element with whatever it likes (it brings its own React), and hands back `getBytes()`, `destroy()` and optional find, zoom, print and theme hooks.

## What a plugin is

A plugin is an optional feature that adds support for a file format. The app loads the plugin's `index.js` at runtime, calls its `mount` function with an element and a context object, and the plugin renders into that element. The plugin can use any UI framework it wants (React, Vue, plain DOM) because it's a self-contained ES module. Mermaid and LaTeX use plain DOM and the shared kit below.

Fields marked optional in `api.ts` can be missing in an older app, so check them (`context.sidebar?.…`).

## Bundled or downloaded

- **Small (under about 1 MB): bundled.** Set `source: { type: 'bundled' }` in the catalog and `"bundled": true` in its `plugin.json`, and add its build to the `plugins:bundled` script (the dev server serves it from there). The app's build builds it into `plugins/<id>/dist` and copies that to `/plugins/<id>/`, so it comes with every install and turning it on is instant. EPUB is one.
- **Bigger: downloaded.** Excalidraw is 16 MB with its fonts, so it's `source: { type: 'download' }`. The app fetches `plugin-<id>-<version>/<id>-<version>.zip` from this repository's releases, checks its `.sig` against the updater's public key, unpacks it into its data folder and loads it through the `wsplugin:` scheme (`src-tauri/src/plugins.rs`).

## API reference

### PluginEditorContext (passed to mount)

| Field | Type | When available | What it does |
|-------|------|----------------|--------------|
| `bytes` | `Uint8Array \| null` | Always | The file's bytes; null for a new, empty document |
| `title` | `string` | Always | The tab's title |
| `theme` | `'light' \| 'dark'` | Always | Current theme |
| `onChange` | `() => void` | Always | Call after every change; marks tab unsaved and autosaves |
| `openExternal` | `(url: string) => void` | Always | Open a link in the default browser |
| `print` | `(content: Node) => Promise<void>` | Always | Print HTML content with system print dialog |
| `sidebar` | `HTMLElement \| undefined` | Only when kind has `panels.left: true` | Element in left sidebar to render into |
| `searchChanged` | `(result: SearchResult) => void` | Only with `search()` hook | Notify that matches changed without new query |
| `path` | `string \| null \| undefined` | Always (null in browser) | Where the file is on disk |
| `previewDelay` | `() => number` | Always | The user's seconds-to-wait before a slow preview (a compile) rebuilds; read it each time |
| `openDocument` | `({ bytes, name }) => void` | Always | Open a document in a new tab (inferred by extension) |
| `saveFile` | `({ bytes, name }) => Promise<boolean>` | Always | Save bytes to a user-picked file (export) |
| `createPdfView` | `(element) => PdfView` | Always | Workspace's own PDF viewer in `element`; `show(bytes)` keeps the place and zoom |
| `tex` | `TexService \| undefined` | In the app (not the browser build), when the catalog entry has `services: ['tex']` | The system's TeX: `status()`, `compile(source, { engine })`, `install()` |

### PluginEditor (returned from mount)

| Method | When available | What it does |
|--------|----------------|--------------|
| `getBytes()` | Always | Return the document as bytes for saving |
| `markSaved()` | Optional | Called after the file was saved |
| `setTheme(theme)` | Optional | Apply theme change |
| `setActive(active)` | Optional | Tab was shown (true) or hidden (false) |
| `find()` | Optional | Open plugin's own find bar (or return `search` instead) |
| `search(query, step)` | Optional | Workspace find bar asks for matches; step is 1 (next), -1 (prev), or 0 (new query) |
| `zoom(direction)` | Optional | Zoom in, out, or reset |
| `print()` | Optional | Print the plugin's content |
| `views` | Optional | Record of view mode labels (e.g., `{ read: 'Diagram', split: 'Source and diagram', write: 'Source' }`) |
| `setView(view)` | Optional (with `views`) | Switch view mode (read/split/write) |
| `destroy()` | Always | Release all resources when tab closes |

## Shared kit

The `plugins/shared` folder has reusable helpers:

- `vite.ts`: `pluginConfig(import.meta.url)` is the one-line Vite config every plugin uses
- `source-preview.ts`: `mountSourcePreview()` gives you a CodeMirror editor on the left and a preview pane on the right, with view switching (read/split/write) and idle delays. Use it for text-to-rendered formats like Markdown, Mermaid, LaTeX. It also exports `sidebarSection`, `sidebarItem`, and `sidebarHint` for styling sidebar content to match Workspace.

## Making a plugin

1. Run `npm run plugin:new -- <id> "<Name>" <ext>` to scaffold from the template. This copies `plugins/template` to `plugins/<id>` and prints the snippets you need to add.
2. Implement your editor in `plugins/<id>/index.ts`. Use the shared kit if it fits (source-and-preview layout, sidebar helpers).
3. Add the catalog entry to `src/plugins/catalog.ts` (the scaffolder prints this).
4. Add the CSS variable `--kind-<id>` to `src/styles/app.css` (pick a color).
5. Add file associations to `src-tauri/tauri.conf.json`.
6. Add your npm packages to `PLUGIN_PACKAGES` in `scripts/licenses.mjs`.
7. Add your build command to the `plugins` npm script in `package.json`.
8. Run `npm run typecheck` and `npm run build` to verify.
9. For downloaded plugins: build it, zip `plugins/<id>/dist` (or run `node scripts/pack-plugin.mjs <id>` with the signing key) and set `size` in `plugin.json` to the zip's size in bytes.
10. Test in the browser (`npm run dev`) and the real app (`npm run app:dev`).

## Checklist

Before releasing a plugin:

- [ ] Catalog entry in `src/plugins/catalog.ts` with correct `source` type
- [ ] `--kind-<id>` CSS variable in `src/styles/app.css`
- [ ] File associations in `src-tauri/tauri.conf.json`
- [ ] Packages listed in `PLUGIN_PACKAGES` in `scripts/licenses.mjs`
- [ ] Build command added to `plugins` npm script
- [ ] `plugin.json` size set after `scripts/pack-plugin.mjs` (for downloaded plugins)
- [ ] Version bumped in `plugin.json` when behavior changes
- [ ] Tag `plugin-<id>-<version>` pushed before an app release (for downloaded plugins)
- [ ] Tested in browser and real app

## Rules learned

- Never write `new URL('./', import.meta.url)` in a plugin entry: Vite inlines it as a `data:` asset. For the plugin's own folder use `import.meta.url.replace(/[^/]*$/, '')` (see `plugins/excalidraw/index.ts`).
- Nothing loads from the network: the app's CSP blocks it. Bundle fonts and other files with the plugin.
- Plugins bring their own framework. The app's React isn't shared.
- Keep `src/plugins/api.ts` import-free so plugins can compile against it.
- Add a plugin's styles to the page once, not once per tab, and put file contents into the page with `textContent`, never `innerHTML`.
- Bundled plugins are built by the app's build; downloaded plugins are built separately and published as releases.

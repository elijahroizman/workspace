# Plugin template

Copy this folder to `plugins/<your-id>` and follow this checklist to make a real plugin.

## Checklist

- [ ] Rename the folder to your plugin id (lowercase letters, digits, dashes only)
- [ ] Update `plugin.json`: set your `id` and `version`. Keep `"size": 0` until you've built and zipped the plugin, then replace it with the zip's size in bytes
- [ ] Leave this as a downloaded plugin (the scaffolder prints `source: { type: 'download' }`). `"bundled": true` is only for a plugin that ships inside the app, like Images
- [ ] Update `vite.config.ts`: add any plugins or config your plugin needs
- [ ] Replace `index.ts` with your editor implementation
- [ ] Add your plugin to `src/plugins/catalog.ts` (see the scaffolder's output for the entry)
- [ ] Add a `--kind-<id>` CSS variable in `src/styles/app.css` (pick a color)
- [ ] Add file associations in `src-tauri/tauri.conf.json` (your extensions)
- [ ] Add your npm packages to `PLUGIN_PACKAGES` in `scripts/licenses.mjs`
- [ ] Add your build command to the `plugins` npm script in `package.json`
- [ ] Run `npm run typecheck` and `npm run build` to verify
- [ ] For downloaded plugins: run `scripts/pack-plugin.mjs <id>` to get the zip size, update `plugin.json` size
- [ ] Test in browser (`npm run dev`) and the real app (`npm run app:dev`)
- [ ] Bump version in `plugin.json` when changing behavior
- [ ] Before an app release: push the tag `plugin-<id>-<version>` (see `.github/workflows/plugins.yml`)
- [ ] The `.gitignore` in this folder keeps `dist/` out of git; keep it in your plugin

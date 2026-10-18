// Builds the EPUB plugin into plugins/epub/dist: index.js (the entry in src/plugins/api.ts) and
// manifest.json. It's bundled: the app's own build runs this and copies dist into the app (see
// bundledPlugins in the root vite.config.ts) instead of publishing a download.

import { writeFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { defineConfig } from 'vite'
import plugin from './plugin.json' with { type: 'json' }

const here = (path: string) => fileURLToPath(new URL(path, import.meta.url))
const outDir = here('./dist')

export default defineConfig({
  root: here('.'),
  logLevel: 'warn',
  plugins: [
    {
      name: 'workspace:plugin-files',
      closeBundle() {
        writeFileSync(`${outDir}/manifest.json`, JSON.stringify({ id: plugin.id, version: plugin.version, apiVersion: 1, entry: 'index.js' }, null, 2))
      },
    },
  ],
  build: {
    outDir,
    emptyOutDir: true,
    target: 'safari15',
    sourcemap: false,
    lib: { entry: here('./index.ts'), formats: ['es'], fileName: () => 'index.js' },
  },
})

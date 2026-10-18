// Builds the Excalidraw plugin into plugins/excalidraw/dist: index.js (the entry in
// src/plugins/api.ts), its chunks, index.css, Excalidraw's fonts and manifest.json.
// `npm run plugins` runs it; scripts/pack-plugin.mjs zips and signs the result for a release.

import { cpSync, writeFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'
import plugin from './plugin.json' with { type: 'json' }

const here = (path: string) => fileURLToPath(new URL(path, import.meta.url))
const outDir = here('./dist')

export default defineConfig({
  root: here('.'),
  plugins: [
    react(),
    {
      name: 'workspace:plugin-files',
      closeBundle() {
        cpSync(here('../../node_modules/@excalidraw/excalidraw/dist/prod/fonts'), `${outDir}/fonts`, { recursive: true })
        writeFileSync(`${outDir}/manifest.json`, JSON.stringify({ id: plugin.id, version: plugin.version, apiVersion: 1, entry: 'index.js' }, null, 2))
      },
    },
  ],
  define: { 'process.env.NODE_ENV': JSON.stringify('production') },
  build: {
    outDir,
    emptyOutDir: true,
    target: 'safari15',
    sourcemap: false,
    chunkSizeWarningLimit: 6000,
    cssCodeSplit: false,
    lib: { entry: here('./index.ts'), formats: ['es'], fileName: () => 'index.js', cssFileName: 'index' },
    rolldownOptions: {
      output: {
        chunkFileNames: 'chunks/[name]-[hash].js',
        // index.ts loads the stylesheet by name.
        assetFileNames: (asset) => (asset.names.some((n) => n.endsWith('.css')) ? 'index.css' : 'assets/[name]-[hash][extname]'),
      },
    },
  },
})

// One Vite config for every plugin: builds plugins/<id>/index.ts into plugins/<id>/dist as an
// ES module (index.js, the entry in src/plugins/api.ts), its chunks, and manifest.json.
// A plugin's vite.config.ts is `export default pluginConfig(import.meta.url)`.

import { readFileSync, writeFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import type { UserConfig } from 'vite'
import { defineConfig, mergeConfig } from 'vite'

export function pluginConfig(configUrl: string, extra: UserConfig = {}) {
  const here = (path: string) => fileURLToPath(new URL(path, configUrl))
  const outDir = here('./dist')
  const plugin = JSON.parse(readFileSync(here('./plugin.json'), 'utf8')) as { id: string; version: string }
  return defineConfig(
    mergeConfig(
      {
        root: here('.'),
        logLevel: 'warn',
        plugins: [
          {
            name: 'workspace:plugin-manifest',
            closeBundle() {
              const { id, version } = plugin
              writeFileSync(`${outDir}/manifest.json`, JSON.stringify({ id, version, apiVersion: 1, entry: 'index.js' }, null, 2))
            },
          },
        ],
        build: {
          outDir,
          emptyOutDir: true,
          target: 'safari15',
          sourcemap: false,
          chunkSizeWarningLimit: 4000,
          lib: { entry: here('./index.ts'), formats: ['es'], fileName: () => 'index.js' },
          rolldownOptions: { output: { chunkFileNames: 'chunks/[name]-[hash].js' } },
        },
      } satisfies UserConfig,
      extra,
    ),
  )
}

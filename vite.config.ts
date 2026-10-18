import { defineConfig } from 'vite'
import type { Plugin } from 'vite'
import react from '@vitejs/plugin-react'
import { existsSync, readFileSync, statSync } from 'node:fs'
import { extname, join, normalize } from 'node:path'

const { version } = JSON.parse(readFileSync(new URL('./package.json', import.meta.url), 'utf8')) as { version: string }

const host = process.env.TAURI_DEV_HOST

/**
 * The PowerPoint engine's handle can add, move and delete slides but not change one: speaker
 * notes, transitions and element order live on the slide. This adds `editSlides(update)` next
 * to its slide methods, an undoable edit of the whole slide list. It fails the build if an
 * engine update moves the code it hooks into.
 */
function pptxEditSlides(): Plugin {
  const anchor = `      toggleHideSlides(indexes) {
        editorOps.slideOps.handleToggleHideSlides(indexes);
      },`
  const method = `
      editSlides(update) {
        editorOps.ops.updateSlides(update);
        history.markDirty();
      },`
  return {
    name: 'workspace:pptx-edit-slides',
    transform(code, id) {
      if (!/pptx-react-viewer[\\/]dist[\\/]chunk-/.test(id) || !code.includes('handleToggleHideSlides(indexes)')) return null
      if (!code.includes(anchor)) this.error('pptx-react-viewer changed: update pptxEditSlides in vite.config.ts')
      return { code: code.replace(anchor, anchor + method), map: null }
    },
  }
}

/**
 * The Word engine won't crop a picture that keeps its proportions (`noChangeAspect`), which Word
 * sets on nearly every picture it inserts. Word itself crops them; the lock is about resizing.
 * The engine checks in two places: what the selected picture allows, and the edit itself. This
 * drops the aspect lock from both, and fails the build if an engine update moves either check.
 */
function docxCropLocked(): Plugin {
  const checks = [
    ['canCrop:e.picture!==null&&!t.resize&&!t.changeAspect&&!e.hidden', 'canCrop:e.picture!==null&&!t.resize&&!e.hidden'],
    ['t==="cropDrawing"&&(n.resize||n.changeAspect)', 't==="cropDrawing"&&n.resize'],
  ]
  const patched = new Set<string>()
  let building = false
  return {
    name: 'workspace:docx-crop-locked',
    configResolved(config) {
      building = config.command === 'build'
    },
    transform(code, id) {
      if (!/@docx-editor\.dev[\\/]core[\\/]dist[\\/]chunk-/.test(id)) return null
      let out = code
      for (const [check, relaxed] of checks) {
        if (!out.includes(check)) continue
        out = out.replace(check, relaxed)
        patched.add(check)
      }
      return out === code ? null : { code: out, map: null }
    },
    generateBundle() {
      // A dev pre-bundle without the engine patches nothing; a build must patch both.
      if ((building || patched.size) && patched.size < checks.length) this.error('@docx-editor.dev/core changed: update docxCropLocked in vite.config.ts')
    },
  }
}

/**
 * Optional plugins are built apart from the app (`npm run plugins`, into plugins/<id>/dist) and
 * the app downloads them. The dev and preview servers serve them at /plugins/<id>/ instead.
 */
function servePlugins(): Plugin {
  const types: Record<string, string> = { '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.woff2': 'font/woff2', '.svg': 'image/svg+xml', '.png': 'image/png' }
  const middleware = (req: { url?: string }, res: import('node:http').ServerResponse, next: () => void) => {
    const m = /^\/plugins\/([a-z0-9-]+)\/([^?#]+)/.exec(req.url ?? '')
    if (!m) return next()
    const file = join(import.meta.dirname, 'plugins', m[1], 'dist', normalize(decodeURIComponent(m[2])).replace(/^(\.\.[/\\])+/, ''))
    if (!existsSync(file) || !statSync(file).isFile()) return next()
    res.setHeader('Content-Type', types[extname(file)] ?? 'application/octet-stream')
    res.end(readFileSync(file))
  }
  return {
    name: 'workspace:serve-plugins',
    configureServer: (server) => void server.middlewares.use(middleware),
    configurePreviewServer: (server) => void server.middlewares.use(middleware),
  }
}

export default defineConfig({
  plugins: [react(), pptxEditSlides(), docxCropLocked(), servePlugins()],
  define: { __APP_VERSION__: JSON.stringify(version) },
  clearScreen: false,
  server: {
    port: 1420,
    strictPort: true,
    host: host || false,
    hmr: host ? { protocol: 'ws', host, port: 1421 } : undefined,
    watch: { ignored: ['**/src-tauri/**'] },
  },
  // The dev server pre-bundles the engines, so they need the patches there too.
  optimizeDeps: { rolldownOptions: { plugins: [pptxEditSlides(), docxCropLocked()] } },
  envPrefix: ['VITE_', 'TAURI_ENV_*'],
  build: {
    // Safari 15 ships with macOS 12, the oldest version we support.
    target: 'safari15',
    chunkSizeWarningLimit: 4000,
    sourcemap: false,
  },
  worker: { format: 'es' },
})

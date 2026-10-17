import { defineConfig } from 'vite'
import type { Plugin } from 'vite'
import react from '@vitejs/plugin-react'

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

export default defineConfig({
  plugins: [react(), pptxEditSlides()],
  clearScreen: false,
  server: {
    port: 1420,
    strictPort: true,
    host: host || false,
    hmr: host ? { protocol: 'ws', host, port: 1421 } : undefined,
    watch: { ignored: ['**/src-tauri/**'] },
  },
  // The dev server pre-bundles the engine, so it needs the patch there too.
  optimizeDeps: { rolldownOptions: { plugins: [pptxEditSlides()] } },
  envPrefix: ['VITE_', 'TAURI_ENV_*'],
  build: {
    // Safari 15 ships with macOS 12, the oldest version we support.
    target: 'safari15',
    chunkSizeWarningLimit: 4000,
    sourcemap: false,
  },
  worker: { format: 'es' },
})

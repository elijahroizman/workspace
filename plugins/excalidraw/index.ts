// The Excalidraw plugin's entry (see src/plugins/api.ts). It stays small: Excalidraw itself
// loads on the first mount, after its fonts are pointed at this plugin's own folder.

import type { PluginEditorContext, PluginModule } from '../../src/plugins/api'

export const apiVersion: PluginModule['apiVersion'] = 1

// This module's folder. (Not `new URL('./', import.meta.url)`: Vite would inline that as an asset.)
const base = import.meta.url.replace(/[^/]*$/, '')

let styled = false

export const mount: PluginModule['mount'] = async (element: HTMLElement, context: PluginEditorContext) => {
  // Without this Excalidraw fetches its fonts from a CDN, which the app doesn't allow.
  ;(window as unknown as { EXCALIDRAW_ASSET_PATH: string }).EXCALIDRAW_ASSET_PATH = base
  if (!styled) {
    styled = true
    const link = document.createElement('link')
    link.rel = 'stylesheet'
    link.href = `${base}index.css`
    document.head.appendChild(link)
  }
  const { mountEditor } = await import('./Editor')
  return mountEditor(element, context)
}

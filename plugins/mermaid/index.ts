// The Mermaid plugin's entry (see src/plugins/api.ts). Mermaid itself (about 3 MB, split into a
// chunk per diagram type) loads on the first mount.

import type { PluginModule } from '../../src/plugins/api'

export const apiVersion: PluginModule['apiVersion'] = 1

export const mount: PluginModule['mount'] = async (element, context) => {
  const { mountEditor } = await import('./editor')
  return mountEditor(element, context)
}

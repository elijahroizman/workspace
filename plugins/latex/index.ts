// The LaTeX plugin's entry (see src/plugins/api.ts). Its catalog entry asks for the `tex`
// service, so Writan hands it the system's TeX (src-tauri/src/tex.rs) and offers to install
// MacTeX or MiKTeX when the plugin is turned on and there's none.

import type { PluginModule } from '../../src/plugins/api'
import { mountEditor } from './editor'

export const apiVersion: PluginModule['apiVersion'] = 1

export const mount: PluginModule['mount'] = (element, context) => mountEditor(element, context)

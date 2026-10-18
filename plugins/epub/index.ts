// The EPUB plugin's entry (see src/plugins/api.ts). It's small enough to ship with the app
// (`source: { type: 'bundled' }` in the catalog), so the app's build copies it in.

import type { PluginModule } from '../../src/plugins/api'
import { mountReader } from './reader'

export const apiVersion: PluginModule['apiVersion'] = 1

export const mount: PluginModule['mount'] = (element, context) => mountReader(element, context)

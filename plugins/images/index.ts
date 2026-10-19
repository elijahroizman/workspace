// The Images plugin's entry (see src/plugins/api.ts): a small viewer for PNG, JPEG and HEIC with
// a few touch-up tools. It's bundled with the app, so turning it on is instant.

import type { PluginModule } from '../../src/plugins/api'
import { mountViewer } from './viewer'

export const apiVersion: PluginModule['apiVersion'] = 1

export const mount: PluginModule['mount'] = (element, context) => mountViewer(element, context)

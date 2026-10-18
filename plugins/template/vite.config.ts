// Builds the plugin into plugins/<id>/dist (see plugins/shared/vite.ts). Pass Vite options as a
// second argument if the plugin needs them (React, say).

import { pluginConfig } from '../shared/vite.ts'

export default pluginConfig(import.meta.url)

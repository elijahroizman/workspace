// Builds the plugin into plugins/latex/dist (see plugins/shared/vite.ts).

import { pluginConfig } from '../shared/vite.ts'

export default pluginConfig(import.meta.url)

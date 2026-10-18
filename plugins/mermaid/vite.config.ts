// Builds the plugin into plugins/mermaid/dist (see plugins/shared/vite.ts).

import { pluginConfig } from '../shared/vite.ts'

export default pluginConfig(import.meta.url)

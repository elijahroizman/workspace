// Builds the Images plugin into plugins/images/dist (see plugins/shared/vite.ts). It's bundled:
// the app's own build runs this and copies dist into the app (bundledPlugins in vite.config.ts).
// The HEIC decoder is a chunk of its own, loaded only for HEIC photos the web view can't read.

import { pluginConfig } from '../shared/vite.ts'

export default pluginConfig(import.meta.url)

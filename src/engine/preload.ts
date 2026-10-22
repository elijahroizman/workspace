// Warms up the document engine while the app is idle: compiles the WebAssembly and loads the
// fonts nearly every Office document uses, so opening the first one doesn't wait for them.

import { preloadFonts } from './host'
import { loadEngine } from './load'

export const BASE_FONTS = ['"Carlito"', '"Caladea"', '"Liberation Sans"', '"Liberation Serif"']

export async function preloadEngine() {
  await loadEngine()
  await preloadFonts(BASE_FONTS)
}

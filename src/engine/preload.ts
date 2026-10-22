// Warms up the document engine while the app is idle: compiles the WebAssembly and loads the
// fonts nearly every Office document uses, so opening the first one doesn't wait for them.

import { host, preloadFonts } from './host'
import { loadEngine } from './load'

export const BASE_FONTS = ['"Carlito"', '"Caladea"', '"Liberation Sans"', '"Liberation Serif"']

export async function preloadEngine() {
  const engine = await loadEngine()
  await preloadFonts(BASE_FONTS)
  // A small document through reading, layout, drawing, typing and saving: the browser compiles
  // WebAssembly functions the first time they run, so the first real document doesn't pay for it.
  const doc = new engine.WordDoc(new Uint8Array(), host)
  doc.layout()
  doc.command(JSON.stringify({ cmd: 'insertText', text: 'Warm up the engine.' }))
  doc.command(JSON.stringify({ cmd: 'enter' }))
  doc.layout()
  doc.paint(0, true)
  doc.overlay()
  doc.state()
  // Saved and opened again, so saving a document read from a file (the lossless path) is warm too.
  const opened = new engine.WordDoc(doc.save(), host)
  doc.free()
  opened.layout()
  opened.command(JSON.stringify({ cmd: 'insertText', text: 'Again.' }))
  opened.layout()
  opened.save()
  opened.free()
}

// Loads the document engine (WebAssembly, built from crates/office-wasm by scripts/engine.mjs)
// once, the first time a Word, PowerPoint or Excel document opens.

import init, * as wasm from './wasm/office_wasm'
import wasmUrl from './wasm/office_wasm_bg.wasm?url'
import './fonts/fonts.css'

export type Engine = typeof wasm

let ready: Promise<Engine> | null = null

export function loadEngine(): Promise<Engine> {
  ready ??= init({ module_or_path: wasmUrl }).then(() => wasm)
  return ready
}

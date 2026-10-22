// A Word document open in the engine: the WebAssembly document, the state the toolbar and
// inspector read, and what the page view needs to draw. Commands go in; after each one the
// layout, the selection and the state are brought up to date and subscribers hear about it.

import { host, onFontsChanged, preloadFonts } from '../host'
import { loadEngine } from '../load'
import { MediaCache, StyleSheet } from '../paint'
import type { WordDoc } from '../wasm/office_wasm'

export interface WordState {
  bold: boolean
  italic: boolean
  underline: boolean
  strike: boolean
  superscript: boolean
  subscript: boolean
  font: string | null
  size: number | null
  color: string | null
  highlight: string | null
  style: string | null
  align: 'left' | 'center' | 'right' | 'justify' | null
  list: 'bullet' | 'numbered' | null
  lineSpacing: number | null
  canUndo: boolean
  canRedo: boolean
  dirty: boolean
  hasSelection: boolean
  table: { rows: number; columns: number } | null
  image: {
    widthEmu: number
    heightEmu: number
    crop: { left: number; top: number; right: number; bottom: number }
    canCrop: boolean
    canResize: boolean
    rotationDegrees: number
    media: string
  } | null
  headerFooter: 'header' | 'footer' | null
  link: string | null
  page: { current: number; total: number }
}

export interface Overlay {
  caret?: [number, number, number, number]
  rects: [number, number, number, number, number][]
  image?: [number, number, number, number, number]
  /** (page, x, y, width, height, set, id) */
  marks?: [number, number, number, number, number, string, string][]
}

const EMPTY_STATE: WordState = {
  bold: false,
  italic: false,
  underline: false,
  strike: false,
  superscript: false,
  subscript: false,
  font: null,
  size: null,
  color: null,
  highlight: null,
  style: null,
  align: null,
  list: null,
  lineSpacing: null,
  canUndo: false,
  canRedo: false,
  dirty: false,
  hasSelection: false,
  table: null,
  image: null,
  headerFooter: null,
  link: null,
  page: { current: 1, total: 1 },
}

let sheets = 0

/** The fonts nearly every document uses, loaded before the first layout. */
const BASE_FONTS = ['"Carlito"', '"Caladea"', '"Liberation Sans"', '"Liberation Serif"']

export class WordEngine {
  readonly doc: WordDoc
  readonly styles: StyleSheet
  readonly media: MediaCache
  /** Every page's size, in pixels. */
  sizes: [number, number][] = []
  state: WordState = EMPTY_STATE
  overlay: Overlay = { rects: [] }
  /** Goes up when pages must be drawn again. */
  revision = 0
  /** Goes up on every change, selection included: what React subscribes to. */
  tick = 0
  /** The page view's text field, which takes the keyboard. */
  input: HTMLTextAreaElement | null = null
  /** Maps between the screen and page coordinates, set by the page view. */
  pagePoint: ((clientX: number, clientY: number) => { page: number; x: number; y: number }) | null = null
  toClient: ((page: number, x: number, y: number) => { x: number; y: number }) | null = null
  /** Colors for each set of marks (find's matches, comments). */
  markStyles: Record<string, { color: string; activeColor?: string; activeId?: string }> = { search: { color: 'rgba(255, 210, 63, 0.55)' } }
  private listeners = new Set<() => void>()
  private stopFonts: () => void
  private disposed = false

  private constructor(doc: WordDoc) {
    this.doc = doc
    this.styles = new StyleSheet(`w${++sheets}s`)
    this.media = new MediaCache((id) => {
      const bytes = this.doc.media(id)
      return bytes ? { bytes, type: this.doc.mediaType(id) ?? 'image/png' } : null
    })
    this.stopFonts = onFontsChanged(() => {
      if (this.disposed) return
      this.doc.fontsChanged()
      this.refresh(true)
    })
  }

  /** Opens a Word file, or a new document for `null`. */
  static async open(bytes: Uint8Array | null): Promise<WordEngine> {
    const engine = await loadEngine()
    await preloadFonts(BASE_FONTS)
    const doc = new engine.WordDoc(bytes ?? new Uint8Array(), host)
    const fonts = (JSON.parse(doc.documentFonts()) as string[]).slice(0, 12).map((f) => `"${f.replace(/"/g, '')}"`)
    if (fonts.length) await preloadFonts(fonts)
    const e = new WordEngine(doc)
    e.refresh(true)
    return e
  }

  subscribe = (f: () => void) => {
    this.listeners.add(f)
    return () => {
      this.listeners.delete(f)
    }
  }

  getTick = () => this.tick

  /** Runs a command; returns its result. */
  run<T = unknown>(cmd: Record<string, unknown> & { cmd: string }): T {
    const out = JSON.parse(this.doc.command(JSON.stringify(cmd))) as T
    this.refresh()
    return out
  }

  /** Brings layout, overlay and state up to date and tells subscribers. */
  refresh(force = false) {
    if (this.disposed) return
    const before = this.revision
    const sizes = this.doc.layout()
    const revision = this.doc.revision()
    if (force || revision !== before) {
      this.sizes = JSON.parse(sizes)
      this.revision = force ? Math.max(revision, before + 1) : revision
    }
    this.overlay = JSON.parse(this.doc.overlay())
    this.state = JSON.parse(this.doc.state())
    this.tick++
    for (const f of this.listeners) f()
  }

  /** Draws a page: its items as HTML, with new paint styles added to the style sheet. */
  paint(page: number) {
    const p = JSON.parse(this.doc.paint(page))
    this.styles.add(p.styles)
    return p as { width: number; height: number; items: import('../paint').PaintItem[] }
  }

  focus() {
    this.input?.focus({ preventScroll: true })
  }

  save(): Uint8Array {
    return this.doc.save()
  }

  dispose() {
    this.disposed = true
    this.stopFonts()
    this.styles.dispose()
    this.media.dispose()
    this.listeners.clear()
    this.doc.free()
  }
}

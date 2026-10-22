// What the comments panel (src/editors/docx/Comments.tsx) needs from the document: its
// paragraphs, finding text in them, highlighting ranges, selecting text, and the saved file.
// Offsets here are JavaScript string offsets into each paragraph's text.

import type { WordEngine } from './engine'

export interface ParagraphInfo {
  paraId: string
  text: string
  /** The paragraph's place in the body. */
  blockId: string
}

export interface TextMatch {
  paragraphIndex: number
  blockId: string
  start: number
  end: number
}

export interface HighlightRange {
  blockId: string
  start: number
  length: number
  expectedText?: string
}

export interface HighlightOptions {
  color: string
  activeColor?: string
  activeIndex?: number
  className?: string
  priority?: number
}

export interface CommentEditor {
  save(): Promise<Uint8Array>
  /** Whether the document has comments at all. */
  hasComments(): boolean
  query(q: { type: 'paragraphs' }): ParagraphInfo[]
  query(q: { type: 'selection' }): { from: { paraId: string }; to: { paraId: string } } | null
  query(q: { type: 'selectedText' }): string
  findMatches(text: string, opts?: { matchCase?: boolean }): TextMatch[]
  setHighlights(name: string, ranges: HighlightRange[], opts: HighlightOptions): void
  clearHighlights(name: string): void
  getHighlightsAt(x: number, y: number): { name: string; index: number; rect: { left: number; top: number; width: number; height: number } }[]
  selectMatch(m: TextMatch): { ok: boolean }
  scrollToAnchor(a: { paraId: string }): void
  /** Puts the keyboard back in the document. */
  focus(): void
  /** The selection's first line on screen. */
  selectionRect(): { left: number; top: number; width: number; height: number } | null
}

const pathOf = (blockId: string) => blockId.split('.').map(Number)

/** The comments panel's view of an open document. */
export function commentEditor(engine: WordEngine): CommentEditor {
  let cache: { revision: number; paragraphs: ParagraphInfo[] } | null = null
  const paragraphs = () => {
    if (cache?.revision === engine.revision) return cache.paragraphs
    const list = (JSON.parse(engine.doc.paragraphs()) as { path: number[]; text: string; paraId?: string | null }[]).map((p) => ({
      // New paragraphs may not have an OOXML id yet. Use the same address everywhere.
      paraId: p.paraId ?? `#${p.path.join('.')}`,
      text: p.text,
      blockId: p.path.join('.'),
    }))
    cache = { revision: engine.revision, paragraphs: list }
    return list
  }
  const editor: CommentEditor = {
    save: async () => engine.save(),
    hasComments: () => engine.doc.hasComments(),
    query: ((q: { type: string }) => {
      if (q.type === 'paragraphs') return paragraphs()
      const sel = JSON.parse(engine.doc.selection()) as { anchor: [number[], number]; focus: [number[], number]; body: boolean }
      if (!sel.body) return q.type === 'selectedText' ? '' : null
      const list = paragraphs()
      const byPath = (p: number[]) => list.find((x) => x.blockId === p.join('.'))
      const [a, b] = comparePos(sel.anchor, sel.focus) <= 0 ? [sel.anchor, sel.focus] : [sel.focus, sel.anchor]
      if (q.type === 'selection') {
        const from = byPath(a[0])
        const to = byPath(b[0])
        return from && to ? { from: { paraId: from.paraId }, to: { paraId: to.paraId } } : null
      }
      // The selected text, paragraphs on their own lines.
      const ia = list.findIndex((x) => x.blockId === a[0].join('.'))
      const ib = list.findIndex((x) => x.blockId === b[0].join('.'))
      if (ia < 0 || ib < 0) return ''
      if (ia === ib) return list[ia].text.slice(a[1], b[1])
      const parts = [list[ia].text.slice(a[1])]
      for (let i = ia + 1; i < ib; i++) parts.push(list[i].text)
      parts.push(list[ib].text.slice(0, b[1]))
      return parts.join('\n')
    }) as CommentEditor['query'],
    findMatches: (text, opts) => {
      const out: TextMatch[] = []
      if (!text) return out
      const needle = opts?.matchCase ? text : text.toLowerCase()
      paragraphs().forEach((p, i) => {
        const hay = opts?.matchCase ? p.text : p.text.toLowerCase()
        for (let at = hay.indexOf(needle); at !== -1; at = hay.indexOf(needle, at + 1)) out.push({ paragraphIndex: i, blockId: p.blockId, start: at, end: at + text.length })
      })
      return out
    },
    setHighlights: (name, ranges, opts) => {
      engine.markStyles[name] = { color: opts.color, activeColor: opts.activeColor, activeId: opts.activeIndex !== undefined && opts.activeIndex >= 0 ? String(opts.activeIndex) : undefined }
      engine.run({ cmd: 'setMarks', set: name, marks: ranges.map((r, i) => [String(i), pathOf(r.blockId), r.start, r.start + r.length]) })
    },
    clearHighlights: (name) => {
      delete engine.markStyles[name]
      engine.run({ cmd: 'setMarks', set: name, marks: [] })
    },
    getHighlightsAt: (x, y) => {
      const at = engine.pagePoint?.(x, y)
      const toClient = engine.toClient
      if (!at || !toClient) return []
      const out: { name: string; index: number; rect: { left: number; top: number; width: number; height: number } }[] = []
      for (const m of engine.overlay.marks ?? []) {
        const [page, mx, my, mw, mh, set, id] = m
        if (page !== at.page || at.x < mx || at.x > mx + mw || at.y < my || at.y > my + mh) continue
        const tl = toClient(page, mx, my)
        const br = toClient(page, mx + mw, my + mh)
        out.push({ name: set, index: Number(id), rect: { left: tl.x, top: tl.y, width: br.x - tl.x, height: br.y - tl.y } })
      }
      return out
    },
    selectMatch: (m) => {
      engine.run({ cmd: 'select', anchor: [pathOf(m.blockId), m.start], focus: [pathOf(m.blockId), m.end] })
      return { ok: true }
    },
    focus: () => engine.focus(),
    selectionRect: () => {
      const r = engine.overlay.rects[0]
      if (!r || !engine.toClient) return null
      const tl = engine.toClient(r[0], r[1], r[2])
      const br = engine.toClient(r[0], r[1] + r[3], r[2] + r[4])
      return { left: tl.x, top: tl.y, width: br.x - tl.x, height: br.y - tl.y }
    },
    scrollToAnchor: ({ paraId }) => {
      const p = paragraphs().find((x) => x.paraId === paraId)
      if (p) engine.run({ cmd: 'goTo', path: pathOf(p.blockId) })
    },
  }
  return editor
}

function comparePos(a: [number[], number], b: [number[], number]) {
  const n = Math.max(a[0].length, b[0].length)
  for (let i = 0; i < n; i++) {
    const d = (a[0][i] ?? -1) - (b[0][i] ?? -1)
    if (d) return d
  }
  return a[1] - b[1]
}

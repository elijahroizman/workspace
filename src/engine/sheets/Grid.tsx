// The spreadsheet grid: cells drawn by the engine a block at a time as the view scrolls, column
// letters and row numbers that stay in view, the selection, and typing into cells.

import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { isMac } from '../../lib/platform'
import type { SheetsEngine } from './engine'
import { columnName } from './engine'
import './grid.css'

const HEAD_W = 46
const HEAD_H = 22
/** Rows and columns drawn beyond the view on each side. */
const MARGIN_ROWS = 20
const MARGIN_COLS = 6

interface Props {
  engine: SheetsEngine
  zoom: number
  active: boolean
  /** Editing a cell: what's typed so far, or null. Shared with the formula bar. */
  editing: string | null
  onEdit: (text: string | null) => void
  onCommit: (text: string, move: 'down' | 'right' | 'up' | 'left' | 'none') => void
  onContextMenu?: (x: number, y: number) => void
}

export function Grid({ engine, zoom, active, editing, onEdit, onCommit, onContextMenu }: Props) {
  const scroller = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLTextAreaElement>(null)
  const cellsRef = useRef<HTMLDivElement>(null)
  const [view, setView] = useState({ left: 0, top: 0, w: 800, h: 600 })
  const [, setTick] = useState(0)
  const drawn = useRef<{ key: string } | null>(null)
  const drag = useRef<null | { kind: 'cells' | 'cols' | 'rows'; from: [number, number] } | { kind: 'resizeCol' | 'resizeRow'; index: number; start: number; size: number }>(null)
  const [resize, setResize] = useState<{ kind: 'col' | 'row'; index: number; size: number } | null>(null)

  useEffect(() => engine.subscribe(() => setTick((t) => t + 1)), [engine])
  useEffect(() => {
    if (active && editing === null) inputRef.current?.focus({ preventScroll: true })
  }, [active, editing, engine])

  const st = engine.state
  const sheet = st.sheet
  const g = engine.geometryOf(sheet)
  const z = zoom

  useLayoutEffect(() => {
    const el = scroller.current!
    const measure = () => setView({ left: el.scrollLeft, top: el.scrollTop, w: el.clientWidth, h: el.clientHeight })
    measure()
    const ro = new ResizeObserver(measure)
    ro.observe(el)
    let frame = 0
    const onScroll = () => {
      cancelAnimationFrame(frame)
      frame = requestAnimationFrame(measure)
    }
    el.addEventListener('scroll', onScroll, { passive: true })
    return () => {
      ro.disconnect()
      el.removeEventListener('scroll', onScroll)
      cancelAnimationFrame(frame)
    }
  }, [])

  // The block of cells in view, with a margin around it.
  const r0 = Math.max(0, g.rowAt(view.top / z) - MARGIN_ROWS)
  const r1 = Math.min(g.info.rows, g.rowAt((view.top + view.h) / z) + MARGIN_ROWS)
  const c0 = Math.max(0, g.colAt(view.left / z) - MARGIN_COLS)
  const c1 = Math.min(g.info.cols, g.colAt((view.left + view.w) / z) + MARGIN_COLS)
  // Draw again only when the block moves past what's drawn, or the sheet changes.
  useLayoutEffect(() => {
    const el = cellsRef.current
    if (!el) return
    const key = `${sheet}:${engine.revision}`
    const block = drawn.current as (null | { key: string; r0: number; r1: number; c0: number; c1: number })
    const inside = block && block.key === key && r0 >= block.r0 && r1 <= block.r1 && c0 >= block.c0 && c1 <= block.c1
    if (inside) return
    // Draw a little more than needed, so small scrolls reuse it.
    const br0 = Math.max(0, r0 - MARGIN_ROWS)
    const br1 = Math.min(g.info.rows, r1 + MARGIN_ROWS)
    const bc0 = Math.max(0, c0 - MARGIN_COLS)
    const bc1 = Math.min(g.info.cols, c1 + MARGIN_COLS)
    el.innerHTML = engine.paint(sheet, br0, br1, bc0, bc1)
    drawn.current = { key, r0: br0, r1: br1, c0: bc0, c1: bc1 } as never
  })

  const range = engine.range
  const selX = g.x(range.c0) * z
  const selY = g.y(range.r0) * z
  const selW = (g.x(range.c1 + 1) - g.x(range.c0)) * z
  const selH = (g.y(range.r1 + 1) - g.y(range.r0)) * z
  const [fr, fc] = st.focus
  const curX = g.x(fc) * z
  const curY = g.y(fr) * z
  const curW = (g.x(fc + 1) - g.x(fc)) * z
  const curH = (g.y(fr + 1) - g.y(fr)) * z

  /** Keeps the focused cell in view. */
  const reveal = (r: number, c: number) => {
    const el = scroller.current!
    const x = g.x(c) * z
    const y = g.y(r) * z
    const w = (g.x(c + 1) - g.x(c)) * z
    const h = (g.y(r + 1) - g.y(r)) * z
    if (x < el.scrollLeft) el.scrollLeft = x
    else if (x + w > el.scrollLeft + el.clientWidth - HEAD_W) el.scrollLeft = x + w - el.clientWidth + HEAD_W
    if (y < el.scrollTop) el.scrollTop = y
    else if (y + h > el.scrollTop + el.clientHeight - HEAD_H) el.scrollTop = y + h - el.clientHeight + HEAD_H
  }

  const select = (anchor: [number, number], focus: [number, number]) => {
    if (editing !== null) onCommit(editing, 'none')
    const clamp = (p: [number, number]): [number, number] => [Math.max(0, Math.min(g.info.rows - 1, p[0])), Math.max(0, Math.min(g.info.cols - 1, p[1]))]
    engine.run({ cmd: 'select', sheet, anchor: clamp(anchor), focus: clamp(focus) })
    reveal(...clamp(focus))
  }

  // ── Pointer
  const cellAt = (e: { clientX: number; clientY: number }): [number, number] => {
    const r = cellsRef.current!.getBoundingClientRect()
    return [g.rowAt((e.clientY - r.top) / z), g.colAt((e.clientX - r.left) / z)]
  }
  const onCellsDown = (e: React.MouseEvent) => {
    if (e.button !== 0) return
    e.preventDefault()
    inputRef.current?.focus({ preventScroll: true })
    const at = cellAt(e)
    if (e.detail >= 2) {
      select(at, at)
      onEdit(engine.cell?.input ?? '')
      return
    }
    if (e.shiftKey) select(st.anchor, at)
    else select(at, at)
    drag.current = { kind: 'cells', from: e.shiftKey ? st.anchor : at }
  }
  const onColHeadDown = (e: React.MouseEvent, c: number) => {
    e.preventDefault()
    inputRef.current?.focus({ preventScroll: true })
    const edge = (e.target as HTMLElement).dataset.edge
    if (edge) {
      const col = Number(edge)
      drag.current = { kind: 'resizeCol', index: col, start: e.clientX, size: g.x(col + 1) - g.x(col) }
      setResize({ kind: 'col', index: col, size: g.x(col + 1) - g.x(col) })
      return
    }
    select([0, e.shiftKey ? st.anchor[1] : c], [g.info.rows - 1, c])
    drag.current = { kind: 'cols', from: [0, c] }
  }
  const onRowHeadDown = (e: React.MouseEvent, r: number) => {
    e.preventDefault()
    inputRef.current?.focus({ preventScroll: true })
    const edge = (e.target as HTMLElement).dataset.edge
    if (edge) {
      const row = Number(edge)
      drag.current = { kind: 'resizeRow', index: row, start: e.clientY, size: g.y(row + 1) - g.y(row) }
      setResize({ kind: 'row', index: row, size: g.y(row + 1) - g.y(row) })
      return
    }
    select([e.shiftKey ? st.anchor[0] : r, 0], [r, g.info.cols - 1])
    drag.current = { kind: 'rows', from: [r, 0] }
  }
  useEffect(() => {
    const move = (e: MouseEvent) => {
      const d = drag.current
      if (!d) return
      if (d.kind === 'resizeCol' || d.kind === 'resizeRow') {
        const delta = ((d.kind === 'resizeCol' ? e.clientX : e.clientY) - d.start) / z
        setResize({ kind: d.kind === 'resizeCol' ? 'col' : 'row', index: d.index, size: Math.max(4, d.size + delta) })
        return
      }
      if (d.kind !== 'cells' && d.kind !== 'cols' && d.kind !== 'rows') return
      const at = cellAt(e)
      if (d.kind === 'cells') select(d.from, at)
      else if (d.kind === 'cols') select([0, d.from[1]], [g.info.rows - 1, at[1]])
      else select([d.from[0], 0], [at[0], g.info.cols - 1])
    }
    const up = () => {
      const d = drag.current
      drag.current = null
      if (d && (d.kind === 'resizeCol' || d.kind === 'resizeRow')) {
        setResize((r) => {
          if (r) engine.run(r.kind === 'col' ? { cmd: 'columnWidth', sheet, col: r.index, px: Math.round(r.size) } : { cmd: 'rowHeight', sheet, row: r.index, px: Math.round(r.size) })
          return null
        })
      }
    }
    window.addEventListener('mousemove', move)
    window.addEventListener('mouseup', up)
    return () => {
      window.removeEventListener('mousemove', move)
      window.removeEventListener('mouseup', up)
    }
  })

  // ── Keyboard (while not editing a cell)
  const onKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.nativeEvent.isComposing) return
    // Keys typed before the cell editor took focus still belong to it.
    if (editing !== null) {
      const move = e.key === 'Enter' ? (e.shiftKey ? 'up' : 'down') : e.key === 'Tab' ? (e.shiftKey ? 'left' : 'right') : null
      if (move) {
        e.preventDefault()
        onCommit(editing, move)
      } else if (e.key === 'Escape') {
        e.preventDefault()
        onEdit(null)
      }
      return
    }
    const mod = isMac ? e.metaKey : e.ctrlKey
    const [r, c] = st.focus
    const step = (dr: number, dc: number) => {
      // ⌘-arrow goes to the edge of the sheet's used cells, roughly as Excel does.
      if (mod) {
        const nr = dr ? (dr > 0 ? g.info.rows - 201 : 0) : r
        const nc = dc ? (dc > 0 ? g.info.cols - 27 : 0) : c
        return e.shiftKey ? select(st.anchor, [Math.max(nr, 0), Math.max(nc, 0)]) : select([Math.max(nr, 0), Math.max(nc, 0)], [Math.max(nr, 0), Math.max(nc, 0)])
      }
      const next: [number, number] = [r + dr, c + dc]
      if (e.shiftKey) select(st.anchor, next)
      else select(next, next)
    }
    switch (e.key) {
      case 'ArrowUp':
        step(-1, 0)
        break
      case 'ArrowDown':
        step(1, 0)
        break
      case 'ArrowLeft':
        step(0, -1)
        break
      case 'ArrowRight':
        step(0, 1)
        break
      case 'Enter':
        step(e.shiftKey ? -1 : 1, 0)
        break
      case 'Tab':
        step(0, e.shiftKey ? -1 : 1)
        break
      case 'PageDown':
        step(Math.max(1, Math.floor(view.h / z / g.info.defaultHeight) - 1), 0)
        break
      case 'PageUp':
        step(-Math.max(1, Math.floor(view.h / z / g.info.defaultHeight) - 1), 0)
        break
      case 'Home':
        select([mod ? 0 : r, 0], [mod ? 0 : r, 0])
        break
      case 'Delete':
      case 'Backspace':
        engine.run({ cmd: 'clear', sheet, range: engine.range })
        break
      case 'F2':
        onEdit(engine.cell?.input ?? '')
        break
      default: {
        if (!mod || e.altKey) return
        const k = e.key.toLowerCase()
        if (k === 'z') engine.run({ cmd: e.shiftKey ? 'redo' : 'undo' })
        else if (k === 'y' && !isMac) engine.run({ cmd: 'redo' })
        else if (k === 'a') select([0, 0], [g.info.rows - 1, g.info.cols - 1])
        else if (k === 'b') engine.run({ cmd: 'format', sheet, range: engine.range, patch: { bold: !engine.cell?.bold } })
        else if (k === 'i') engine.run({ cmd: 'format', sheet, range: engine.range, patch: { italic: !engine.cell?.italic } })
        else if (k === 'u') engine.run({ cmd: 'format', sheet, range: engine.range, patch: { underline: !engine.cell?.underline } })
        else return
      }
    }
    e.preventDefault()
    e.stopPropagation()
  }

  // Typing on a cell starts editing it with what was typed.
  // (A native listener: React's onBeforeInput comes from textInput, without an inputType.)
  const onBeforeInput = (ev: InputEvent) => {
    if (ev.inputType === 'historyUndo' || ev.inputType === 'historyRedo') {
      ev.preventDefault()
      engine.run({ cmd: ev.inputType === 'historyUndo' ? 'undo' : 'redo' })
      return
    }
    if (ev.inputType === 'insertText' && ev.data && !ev.isComposing) {
      ev.preventDefault()
      onEdit((editing ?? '') + ev.data)
    }
  }
  const beforeInput = useRef(onBeforeInput)
  beforeInput.current = onBeforeInput
  useEffect(() => {
    const el = inputRef.current!
    const f = (e: InputEvent) => beforeInput.current(e)
    el.addEventListener('beforeinput', f)
    return () => el.removeEventListener('beforeinput', f)
  }, [])

  const onCopy = (e: React.ClipboardEvent, cut: boolean) => {
    const rr = engine.range
    e.preventDefault()
    e.clipboardData.setData('text/plain', engine.doc.copy(sheet, rr.r0, rr.c0, rr.r1, rr.c1))
    if (cut) engine.run({ cmd: 'clear', sheet, range: rr })
  }
  const onPaste = (e: React.ClipboardEvent) => {
    const text = e.clipboardData.getData('text/plain')
    if (!text) return
    e.preventDefault()
    engine.run({ cmd: 'paste', sheet, range: engine.range, text })
  }

  // ── Headers in view
  const cols: number[] = []
  for (let c = c0; c < c1; c++) cols.push(c)
  const rows: number[] = []
  for (let r = r0; r < r1; r++) rows.push(r)
  const inSel = (k: number, lo: number, hi: number) => k >= lo && k <= hi

  return (
    <div className="sg-scroller" ref={scroller} onContextMenu={(e) => {
      e.preventDefault()
      const at = cellAt(e)
      if (!(inSel(at[0], range.r0, range.r1) && inSel(at[1], range.c0, range.c1))) select(at, at)
      onContextMenu?.(e.clientX, e.clientY)
    }}>
      <div className="sg-space" style={{ width: g.width * z + HEAD_W, height: g.height * z + HEAD_H }}>
        <div className="sg-corner" onMouseDown={(e) => {
          e.preventDefault()
          select([0, 0], [g.info.rows - 1, g.info.cols - 1])
        }} />
        <div className="sg-colheads" style={{ width: g.width * z }}>
          {cols.map((c) => (
            <div key={c} className={`sg-colhead ${inSel(c, range.c0, range.c1) ? 'on' : ''}`} style={{ left: g.x(c) * z, width: (g.x(c + 1) - g.x(c)) * z }} onMouseDown={(e) => onColHeadDown(e, c)}>
              {columnName(c)}
              <span className="sg-edge" data-edge={c} />
            </div>
          ))}
        </div>
        <div className="sg-rowheads" style={{ height: g.height * z }}>
          {rows.map((r) => (
            <div key={r} className={`sg-rowhead ${inSel(r, range.r0, range.r1) ? 'on' : ''}`} style={{ top: g.y(r) * z, height: (g.y(r + 1) - g.y(r)) * z }} onMouseDown={(e) => onRowHeadDown(e, r)}>
              {r + 1}
              <span className="sg-edge" data-edge={r} />
            </div>
          ))}
        </div>
        <div className="sg-body" style={{ width: g.width * z, height: g.height * z }} onMouseDown={onCellsDown}>
          <div className="sg-cells" ref={cellsRef} style={{ width: g.width, height: g.height, transform: `scale(${z})` }} />
          <div className="sg-sel" style={{ left: selX, top: selY, width: selW, height: selH }} />
          <div className="sg-cur" style={{ left: curX, top: curY, width: curW, height: curH }} />
          {resize && (
            <div
              className="sg-resize-guide"
              style={resize.kind === 'col' ? { left: (g.x(resize.index) + resize.size) * z, top: 0, width: 1, height: '100%' } : { top: (g.y(resize.index) + resize.size) * z, left: 0, height: 1, width: '100%' }}
            />
          )}
          {editing !== null && (
            <CellEditor
              value={editing}
              style={{ left: curX, top: curY, minWidth: curW, minHeight: curH, fontSize: Math.max(11, (engine.cell?.size ?? 11) * (96 / 72) * z) }}
              onChange={onEdit}
              onCommit={(move) => onCommit(editing, move)}
              onCancel={() => onEdit(null)}
            />
          )}
        </div>
        <textarea
          ref={inputRef}
          className="sg-input"
          data-engine-input=""
          aria-label="Cells"
          style={{ left: curX + HEAD_W, top: curY + HEAD_H }}
          onKeyDown={onKeyDown}
          onCompositionEnd={(e) => {
            const v = e.data
            ;(e.target as HTMLTextAreaElement).value = ''
            if (v) onEdit(v)
          }}
          onCopy={(e) => onCopy(e, false)}
          onCut={(e) => onCopy(e, true)}
          onPaste={onPaste}
        />
      </div>
    </div>
  )
}

/** The box typed into on the cell itself. Enter and Tab commit and move; Escape cancels. */
function CellEditor({ value, style, onChange, onCommit, onCancel }: { value: string; style: React.CSSProperties; onChange: (v: string) => void; onCommit: (move: 'down' | 'right' | 'up' | 'left' | 'none') => void; onCancel: () => void }) {
  const ref = useRef<HTMLTextAreaElement>(null)
  // Focused before the next key arrives, so a fast typist's second letter lands here.
  useLayoutEffect(() => {
    const el = ref.current!
    el.focus({ preventScroll: true })
    el.setSelectionRange(el.value.length, el.value.length)
  }, [])
  return (
    <textarea
      ref={ref}
      className="sg-editor"
      data-engine-input=""
      value={value}
      style={style}
      spellCheck={false}
      onMouseDown={(e) => e.stopPropagation()}
      onChange={(e) => onChange(e.target.value)}
      onKeyDown={(e) => {
        if (e.key === 'Enter' && (e.altKey || (isMac ? false : e.ctrlKey))) return
        if (e.key === 'Enter') {
          e.preventDefault()
          onCommit(e.shiftKey ? 'up' : 'down')
        } else if (e.key === 'Tab') {
          e.preventDefault()
          onCommit(e.shiftKey ? 'left' : 'right')
        } else if (e.key === 'Escape') {
          e.preventDefault()
          onCancel()
        }
        e.stopPropagation()
      }}
    />
  )
}

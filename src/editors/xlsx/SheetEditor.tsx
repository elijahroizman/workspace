import {
  AlignCenter,
  AlignLeft,
  AlignRight,
  ArrowDownToLine,
  ArrowLeftToLine,
  ArrowRightToLine,
  ArrowUpToLine,
  Bold,
  Italic,
  Merge,
  Minus,
  Plus,
  Redo2,
  Strikethrough,
  Trash2,
  Underline,
  Undo2,
  WrapText,
} from 'lucide-react'
import { useEffect, useRef, useState, useSyncExternalStore } from 'react'
import type { EditorProps } from '../../App'
import { FindBar, InspectorHeader, Workbench, formatZoom } from '../../components/Workbench'
import type { MenuEntry } from '../../components/ui'
import { Button, CenterState, ColorField, Hint, IconButton, NumberField, PopoverMenu, Section, Segmented, SelectField, TextField } from '../../components/ui'
import { SheetsEngine } from '../../engine/sheets/engine'
import { Grid } from '../../engine/sheets/Grid'
import { registerEditor, useWorkspace } from '../../state/workspace'
import './sheets.css'

const NUMBER_FORMATS = [
  { value: 'General', label: 'General' },
  { value: '0', label: 'Number (1234)' },
  { value: '#,##0.00', label: 'Number (1,234.00)' },
  { value: '"$"#,##0.00', label: 'Currency ($1,234.00)' },
  { value: '0%', label: 'Percent (12%)' },
  { value: '0.00%', label: 'Percent (12.34%)' },
  { value: 'yyyy-mm-dd', label: 'Date (2026-01-31)' },
  { value: 'm/d/yyyy', label: 'Date (1/31/2026)' },
  { value: 'mmm d, yyyy', label: 'Date (Jan 31, 2026)' },
  { value: 'h:mm AM/PM', label: 'Time (9:30 AM)' },
  { value: '0.00E+00', label: 'Scientific (1.23E+03)' },
  { value: '@', label: 'Text' },
]
const FONTS = ['Calibri', 'Arial', 'Helvetica', 'Times New Roman', 'Courier New', 'Georgia', 'Verdana', 'Aptos']
const ZOOM_STEPS = [0.5, 0.67, 0.75, 0.9, 1, 1.1, 1.25, 1.5, 1.75, 2]

export default function SheetEditor({ tab, active }: EditorProps) {
  const [engine, setEngine] = useState<SheetsEngine | null>(null)
  const [error, setError] = useState<string | null>(null)
  const name = useRef('')
  name.current = tab.path ?? `${tab.title}.${tab.kind}`
  useEffect(() => {
    let live = true
    let opened: SheetsEngine | null = null
    setEngine(null)
    setError(null)
    SheetsEngine.open(tab.bytes, name.current)
      .then((e) => {
        if (!live) return e.dispose()
        opened = e
        if (import.meta.env.DEV || import.meta.env.VITE_TEST_HOOKS) Object.assign(window, { __sheets: e })
        setEngine(e)
      })
      .catch((e) => { if (live) setError(String(e?.message ?? e)) })
    return () => {
      live = false
      opened?.dispose()
    }
  }, [tab.bytes, tab.kind])
  if (error) {
    return (
      <CenterState title="Couldn’t open this spreadsheet">
        <p className="muted">{error}</p>
      </CenterState>
    )
  }
  if (!engine) return <CenterState spinner />
  return <Book tab={tab} active={active} engine={engine} />
}

function Book({ tab, active, engine }: EditorProps & { engine: SheetsEngine }) {
  useSyncExternalStore(engine.subscribe, engine.getTick)
  const st = engine.state
  const cell = engine.cell
  const sheet = st.sheet
  const markDirty = useWorkspace((s) => s.markDirty)
  const [editing, setEditing] = useState<string | null>(null)
  const draft = useRef<{ text: string; original: string; sheet: number; row: number; col: number } | null>(null)
  const [zoom, setZoom] = useState(1)
  const [menu, setMenu] = useState<{ x: number; y: number; items: MenuEntry[] } | null>(null)
  const [findOpen, setFindOpen] = useState<false | 'find' | 'replace'>(false)
  const [matches, setMatches] = useState<{ sheet: number; row: number; col: number }[]>([])
  const [matchIndex, setMatchIndex] = useState(0)
  const zoomRef = useRef(zoom)
  zoomRef.current = zoom

  useEffect(() => {
    let revision = engine.revision
    let dirty = engine.state.dirty
    return engine.subscribe(() => {
      if (engine.revision !== revision || engine.state.dirty !== dirty) {
        revision = engine.revision
        dirty = engine.state.dirty
        markDirty(tab.id, dirty || !!(draft.current && draft.current.text !== draft.current.original))
      }
    })
  }, [engine, markDirty, tab.id])

  const edit = (text: string | null) => {
    if (text === null) draft.current = null
    else if (draft.current) draft.current.text = text
    else {
      const { sheet, focus: [row, col] } = engine.state
      draft.current = { text, original: engine.cell?.input ?? '', sheet, row, col }
    }
    setEditing(text)
    markDirty(tab.id, engine.state.dirty || !!(draft.current && draft.current.text !== draft.current.original))
  }

  const flushDraft = () => {
    const d = draft.current
    if (!d) return
    draft.current = null
    setEditing(null)
    engine.run({ cmd: 'input', sheet: d.sheet, row: d.row, col: d.col, text: d.text })
  }

  const range = engine.range
  const run = <T = unknown,>(cmd: Record<string, unknown> & { cmd: string }) => {
    flushDraft()
    return engine.run<T>(cmd)
  }
  const format = (patch: Record<string, unknown>) => run({ cmd: 'format', sheet, range, patch })

  /** Puts what was typed into the focused cell, then moves as Enter or Tab asks. */
  const commit = (text: string, move: 'down' | 'right' | 'up' | 'left' | 'none') => {
    const d = draft.current
    const [r, c] = d ? [d.row, d.col] : engine.state.focus
    const targetSheet = d?.sheet ?? engine.state.sheet
    draft.current = null
    setEditing(null)
    engine.run({ cmd: 'input', sheet: targetSheet, row: r, col: c, text })
    const next: [number, number] = move === 'down' ? [r + 1, c] : move === 'up' ? [Math.max(0, r - 1), c] : move === 'right' ? [r, c + 1] : move === 'left' ? [r, Math.max(0, c - 1)] : [r, c]
    if (engine.state.sheet === targetSheet) engine.run({ cmd: 'select', sheet: targetSheet, anchor: next, focus: next })
  }

  const zoomStep = (dir: 'in' | 'out' | 'fit' | 'reset') => {
    if (dir === 'fit' || dir === 'reset') return setZoom(1)
    const z = zoomRef.current
    const next = dir === 'in' ? ZOOM_STEPS.find((s) => s > z + 0.001) : [...ZOOM_STEPS].reverse().find((s) => s < z - 0.001)
    if (next) setZoom(next)
  }

  // ── Find across every sheet.
  const query = useRef('')
  const runFind = (q: string, from = 0) => {
    query.current = q
    const found = q.trim() ? run<{ sheet: number; row: number; col: number }[]>({ cmd: 'find', query: q }) : []
    setMatches(found)
    const i = Math.min(from, Math.max(0, found.length - 1))
    setMatchIndex(i)
    if (found[i]) goTo(found[i])
  }
  const goTo = (m: { sheet: number; row: number; col: number }) => run({ cmd: 'select', sheet: m.sheet, anchor: [m.row, m.col], focus: [m.row, m.col] })
  const stepFind = (d: number) => {
    if (!matches.length) return
    const i = (matchIndex + d + matches.length) % matches.length
    setMatchIndex(i)
    goTo(matches[i])
  }

  useEffect(
    () =>
      registerEditor(tab.id, {
        prepareSave: flushDraft,
        getRevision: () => engine.revision,
        getBytes: async () => { flushDraft(); return engine.save() },
        busy: () => draft.current !== null,
        markSaved: () => {
          engine.run({ cmd: 'markSaved' })
          markDirty(tab.id, false)
        },
        find: () => setFindOpen('find'),
        replace: () => setFindOpen('replace'),
        zoom: (dir) => zoomStep(dir),
        actions: {
          'text.bold': () => void engine.run({ cmd: 'format', sheet: engine.state.sheet, range: engine.range, patch: { bold: !engine.cell?.bold } }),
          'text.italic': () => void engine.run({ cmd: 'format', sheet: engine.state.sheet, range: engine.range, patch: { italic: !engine.cell?.italic } }),
          'text.underline': () => void engine.run({ cmd: 'format', sheet: engine.state.sheet, range: engine.range, patch: { underline: !engine.cell?.underline } }),
        },
      }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [tab.id, engine, markDirty],
  )

  const sheetMenu = (index: number, x: number, y: number) =>
    setMenu({
      x,
      y,
      items: [
        {
          label: 'Rename…',
          onSelect: () => {
            const name = window.prompt('Sheet name', engine.sheets[index]?.name ?? '')
            if (name) run({ cmd: 'renameSheet', sheet: index, name })
          },
        },
        ...(index > 0 ? [{ label: 'Move up', onSelect: () => run({ cmd: 'moveSheet', from: index, to: index - 1 }) }] : []),
        ...(index < engine.sheets.length - 1 ? [{ label: 'Move down', onSelect: () => run({ cmd: 'moveSheet', from: index, to: index + 1 }) }] : []),
        { label: 'Delete sheet', icon: <Trash2 size={14} />, danger: true, separatorBefore: true, disabled: engine.sheets.length <= 1, onSelect: () => run({ cmd: 'deleteSheet', sheet: index }) },
      ],
    })

  const cellMenu = (x: number, y: number) => {
    const range = engine.range
    const sheet = engine.state.sheet
    const cell = engine.cell
    setMenu({
      x,
      y,
      items: [
        { label: 'Insert row above', icon: <ArrowUpToLine size={14} />, onSelect: () => run({ cmd: 'shiftRows', sheet, at: range.r0, n: 1 }) },
        { label: 'Insert column left', icon: <ArrowLeftToLine size={14} />, onSelect: () => run({ cmd: 'shiftCols', sheet, at: range.c0, n: 1 }) },
        { label: 'Delete rows', icon: <Minus size={14} />, separatorBefore: true, onSelect: () => run({ cmd: 'shiftRows', sheet, at: range.r0, n: -(range.r1 - range.r0 + 1) }) },
        { label: 'Delete columns', icon: <Minus size={14} />, onSelect: () => run({ cmd: 'shiftCols', sheet, at: range.c0, n: -(range.c1 - range.c0 + 1) }) },
        { label: cell?.merged ? 'Unmerge' : 'Merge cells', icon: <Merge size={14} />, separatorBefore: true, onSelect: () => run({ cmd: 'merge', sheet, range }) },
        { label: 'Clear', icon: <Trash2 size={14} />, danger: true, separatorBefore: true, onSelect: () => run({ cmd: 'clear', sheet, range }) },
      ],
    })
  }

  const left = (
    <nav className="list" aria-label="Sheets">
      {engine.sheets.map((s, i) => (
        <button
          key={`${i}-${s.name}`}
          type="button"
          className={`list-item ${i === sheet ? 'active' : ''}`}
          onClick={() => run({ cmd: 'select', sheet: i, anchor: [0, 0], focus: [0, 0] })}
          onDoubleClick={() => {
            const name = window.prompt('Sheet name', s.name)
            if (name) run({ cmd: 'renameSheet', sheet: i, name })
          }}
          onContextMenu={(e) => {
            e.preventDefault()
            sheetMenu(i, e.clientX, e.clientY)
          }}
        >
          <span className="label">{s.name}</span>
        </button>
      ))}
      {!st.csv && (
        <button type="button" className="list-item add-sheet" onClick={() => run({ cmd: 'addSheet' })}>
          <Plus size={13} /> <span className="label">Add sheet</span>
        </button>
      )}
    </nav>
  )

  const size = range.r1 - range.r0 + 1
  const width = range.c1 - range.c0 + 1

  return (
    <Workbench
      tab={tab}
      left={left}
      leftFooter={<span>{engine.sheets.length === 1 ? '1 sheet' : `${engine.sheets.length} sheets`}</span>}
      right={
        <>
          <InspectorHeader kind={tab.kind}>{st.csv ? 'CSV file' : 'Workbook'}</InspectorHeader>
          <Section title={size * width > 1 ? `${size * width} cells` : `Cell ${cell?.address ?? ''}`}>
            <SelectField label="Number format" value={NUMBER_FORMATS.some((f) => f.value === cell?.numberFormat) ? (cell?.numberFormat ?? null) : null} placeholder={cell?.numberFormat || 'Custom'} options={NUMBER_FORMATS} onChange={(v) => format({ numberFormat: v })} />
          </Section>
          <Section title="Text">
            <div className="docx-font-row">
              <SelectField value={cell?.font ?? 'Calibri'} options={[...new Set([...(cell?.font ? [cell.font] : []), ...FONTS])].map((f) => ({ value: f, label: f }))} onChange={(f) => format({ font: f })} />
              <NumberField label={<span className="faint">pt</span>} value={cell?.size ?? 11} precision={1} step={1} min={1} max={409} onCommit={(v) => format({ size: v })} />
            </div>
            <div className="toggle-row">
              <IconButton label="Bold (⌘B)" active={!!cell?.bold} onClick={() => format({ bold: !cell?.bold })}>
                <Bold size={15} />
              </IconButton>
              <IconButton label="Italic (⌘I)" active={!!cell?.italic} onClick={() => format({ italic: !cell?.italic })}>
                <Italic size={15} />
              </IconButton>
              <IconButton label="Underline (⌘U)" active={!!cell?.underline} onClick={() => format({ underline: !cell?.underline })}>
                <Underline size={15} />
              </IconButton>
              <IconButton label="Strikethrough" active={!!cell?.strike} onClick={() => format({ strike: !cell?.strike })}>
                <Strikethrough size={15} />
              </IconButton>
              <IconButton label="Wrap text" active={!!cell?.wrap} onClick={() => format({ wrap: !cell?.wrap })}>
                <WrapText size={15} />
              </IconButton>
            </div>
            <div className="grid-2">
              <ColorField value={cell?.color ?? null} label="Text" onChange={(hex) => format({ color: hex })} />
              <ColorField value={cell?.fill ?? null} label="Fill" onChange={(hex) => format({ fill: hex })} />
            </div>
            {cell?.fill && (
              <Button block onClick={() => format({ fill: '' })}>
                No fill
              </Button>
            )}
          </Section>
          <Section title="Alignment">
            <Segmented
              value={(cell?.align as 'left' | 'center' | 'right' | null) ?? null}
              onChange={(a) => format({ align: a })}
              options={[
                { value: 'left', icon: <AlignLeft size={15} />, title: 'Align left' },
                { value: 'center', icon: <AlignCenter size={15} />, title: 'Center' },
                { value: 'right', icon: <AlignRight size={15} />, title: 'Align right' },
              ]}
            />
            <Segmented
              value={(cell?.valign as 'top' | 'center' | null) ?? 'bottom'}
              onChange={(a) => format({ valign: a })}
              options={[
                { value: 'top', label: 'Top' },
                { value: 'center', label: 'Middle' },
                { value: 'bottom', label: 'Bottom' },
              ]}
            />
          </Section>
          <Section title="Borders" collapsible defaultOpen={false}>
            <div className="grid-2">
              <Button onClick={() => format({ borders: 'all' })}>All</Button>
              <Button onClick={() => format({ borders: 'outside' })}>Outside</Button>
              <Button onClick={() => format({ borders: 'bottom' })}>Bottom</Button>
              <Button onClick={() => format({ borders: 'none' })}>None</Button>
            </div>
          </Section>
          <Section title="Rows and columns">
            <span className="field-caption">Rows</span>
            <div className="toggle-row">
              <IconButton label="Insert row above" onClick={() => run({ cmd: 'shiftRows', sheet, at: range.r0, n: 1 })}>
                <ArrowUpToLine size={15} />
              </IconButton>
              <IconButton label="Insert row below" onClick={() => run({ cmd: 'shiftRows', sheet, at: range.r1 + 1, n: 1 })}>
                <ArrowDownToLine size={15} />
              </IconButton>
              <IconButton label="Delete rows" onClick={() => run({ cmd: 'shiftRows', sheet, at: range.r0, n: -size })}>
                <Minus size={15} />
              </IconButton>
            </div>
            <span className="field-caption">Columns</span>
            <div className="toggle-row">
              <IconButton label="Insert column left" onClick={() => run({ cmd: 'shiftCols', sheet, at: range.c0, n: 1 })}>
                <ArrowLeftToLine size={15} />
              </IconButton>
              <IconButton label="Insert column right" onClick={() => run({ cmd: 'shiftCols', sheet, at: range.c1 + 1, n: 1 })}>
                <ArrowRightToLine size={15} />
              </IconButton>
              <IconButton label="Delete columns" onClick={() => run({ cmd: 'shiftCols', sheet, at: range.c0, n: -width })}>
                <Minus size={15} />
              </IconButton>
            </div>
            <Button block onClick={() => run({ cmd: 'merge', sheet, range })}>
              <Merge size={14} /> {cell?.merged ? 'Unmerge cells' : 'Merge cells'}
            </Button>
            <Hint tone="faint" as="p">Drag a column or row edge in the headers to resize it.</Hint>
          </Section>
          {!st.csv && (
            <Section title="Sheet" collapsible defaultOpen={false}>
              <TextField
                key={`${sheet}-${engine.sheets[sheet]?.name}`}
                defaultValue={engine.sheets[sheet]?.name ?? ''}
                aria-label="Sheet name"
                onKeyDown={(e) => {
                  if (e.key === 'Enter') run({ cmd: 'renameSheet', sheet, name: e.currentTarget.value })
                }}
                onBlur={(e) => run({ cmd: 'renameSheet', sheet, name: e.currentTarget.value })}
              />
              <Button variant="danger" block disabled={engine.sheets.length <= 1} onClick={() => run({ cmd: 'deleteSheet', sheet })}>
                <Trash2 size={14} /> Delete sheet
              </Button>
            </Section>
          )}
          <Section title="File" collapsible defaultOpen={false}>
            <p className="faint" style={{ margin: 0, fontSize: 12 }}>
              {tab.path ? tab.path.replace(/^\/Users\/[^/]+/, '~') : 'Not saved yet'}
            </p>
          </Section>
        </>
      }
    >
      <div className="sheet-stage">
        <div className="formula-bar">
          <span className="formula-address">{cell?.address}</span>
          <span className="formula-fx">fx</span>
          <input
            className="formula-input"
            data-engine-input=""
            aria-label="Cell contents"
            value={editing ?? cell?.input ?? ''}
            spellCheck={false}
            onChange={(e) => edit(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                e.preventDefault()
                commit(editing ?? cell?.input ?? '', 'down')
              } else if (e.key === 'Escape') {
                e.preventDefault()
                edit(null)
              } else if (e.key === 'Tab') {
                e.preventDefault()
                commit(editing ?? cell?.input ?? '', 'right')
              }
              e.stopPropagation()
            }}
          />
        </div>
        <div className="sheet-grid">
          <Grid engine={engine} zoom={zoom} active={active} editing={editing} onEdit={edit} onCommit={commit} onContextMenu={cellMenu} />
        </div>
      </div>
      <FindBar
        open={!!findOpen}
        replacing={findOpen === 'replace'}
        onClose={() => setFindOpen(false)}
        onQuery={(q) => runFind(q)}
        onNext={() => stepFind(1)}
        onPrev={() => stepFind(-1)}
        onReplace={(by) => {
          run({ cmd: 'replaceMatch', index: matchIndex, text: by })
          runFind(query.current, matchIndex)
        }}
        onReplaceAll={(by) => {
          run({ cmd: 'replaceAll', text: by })
          runFind(query.current)
        }}
        count={matches.length}
        current={matchIndex}
        placeholder="Find in cells"
      />
      <div className="canvas-bar">
        <IconButton label="Undo (⌘Z)" size="sm" disabled={!st.canUndo} onClick={() => run({ cmd: 'undo' })}>
          <Undo2 size={14} />
        </IconButton>
        <IconButton label="Redo (⇧⌘Z)" size="sm" disabled={!st.canRedo} onClick={() => run({ cmd: 'redo' })}>
          <Redo2 size={14} />
        </IconButton>
        <span className="sep" />
        <span className="readout">{engine.sheets[sheet]?.name}</span>
        <span className="sep" />
        <IconButton label="Zoom out (⌘−)" size="sm" onClick={() => zoomStep('out')} disabled={zoom <= ZOOM_STEPS[0] + 0.001}>
          <Minus size={14} />
        </IconButton>
        <IconButton label="Actual size (⌘0)" size="sm" className="readout" aria-label={formatZoom(zoom)} onClick={() => zoomStep('fit')}>
          {formatZoom(zoom)}
        </IconButton>
        <IconButton label="Zoom in (⌘+)" size="sm" onClick={() => zoomStep('in')} disabled={zoom >= ZOOM_STEPS[ZOOM_STEPS.length - 1] - 0.001}>
          <Plus size={14} />
        </IconButton>
      </div>
      {menu && <PopoverMenu anchor={menu} items={menu.items} onClose={() => setMenu(null)} />}
    </Workbench>
  )
}

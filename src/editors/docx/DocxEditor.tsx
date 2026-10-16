import { blankDocumentBytes, chromeProbeForSlot, commandForSlot, commandForSlotValue } from '@docx-editor.dev/core/editor'
import '@docx-editor.dev/core/styles/editor.css'
import { packagedFonts } from '@docx-editor.dev/fonts'
import type { Editor } from '@docx-editor.dev/react'
import {
  DocxEditor,
  ImageInsertTrigger,
  useDocumentOutline,
  useDocumentSearch,
  useDocxEditor,
  useEditorCommand,
  useEditorEvent,
  useEditorState,
  useEditorValueCommand,
  useFontFamily,
  useFonts,
  useHyperlinkPopup,
  usePageSetup,
  useParagraphStyle,
  useZoom,
} from '@docx-editor.dev/react'
import {
  AlignCenter,
  AlignJustify,
  AlignLeft,
  AlignRight,
  ArrowDownToLine,
  ArrowLeftToLine,
  ArrowRightToLine,
  ArrowUpToLine,
  Bold,
  FileStack,
  Image as ImageIcon,
  IndentDecrease,
  IndentIncrease,
  Italic,
  Link,
  List,
  ListOrdered,
  ListTree,
  Minus,
  Plus,
  Redo2,
  RemoveFormatting,
  Strikethrough,
  Subscript,
  Superscript,
  Table,
  Trash2,
  Underline,
  Undo2,
} from 'lucide-react'
import type { ReactNode } from 'react'
import { use, useEffect, useMemo, useRef, useState } from 'react'
import type { EditorProps } from '../../App'
import { FindBar, InspectorHeader, Workbench, formatZoom } from '../../components/Workbench'
import { ColorField, IconButton, NumberField, Section, Segmented, SelectField, TableSizePicker } from '../../components/ui'
import { usePinchZoom } from '../../lib/pinch'
import { shortcut } from '../../lib/platform'
import { registerEditor, useWorkspace } from '../../state/workspace'
import './docx.css'

type EditorCommand = Parameters<Editor['exec']>[0]

// The packaged shell mounts the link popover itself; this composed editor has to ask for it.
const POPUPS = { hyperlink: () => <LinkPopover /> }

// One font resolver for every Word tab, so each face is fetched and parsed once.
const FONTS = packagedFonts()

// New documents start on A4 paper. The engine's blank template is US Letter.
let blankA4: Promise<Uint8Array> | null = null
function blankA4Document() {
  blankA4 ??= (async () => {
    const { default: JSZip } = await import('jszip')
    const zip = await JSZip.loadAsync(blankDocumentBytes())
    const xml = await zip.file('word/document.xml')!.async('string')
    zip.file('word/document.xml', xml.replace(/<w:pgSz\b[^>]*\/>/, '<w:pgSz w:w="11906" w:h="16838"/>'))
    return zip.generateAsync({ type: 'uint8array' })
  })()
  return blankA4
}

export default function DocxTab({ tab, active }: EditorProps) {
  const fonts = useFonts(FONTS)
  const blank = tab.bytes ? null : use(blankA4Document())
  // A copy per tab, so two new documents never share bytes.
  const document = useMemo(() => tab.bytes ?? blank!.slice(), [tab.bytes, blank])
  const savedRevision = useRef<number | null>(null)
  const markDirty = useWorkspace((s) => s.markDirty)

  return (
    <DocxEditor.Root
      document={document}
      fonts={fonts}
      mode="edit"
      popups={POPUPS}
      author="Workspace"
      onReady={(editor) => {
        savedRevision.current = editor.getDocumentHandle().revision
      }}
      onChange={(change) => {
        if (change.source === 'load') {
          savedRevision.current = change.revision
          return
        }
        markDirty(tab.id, change.revision !== savedRevision.current)
      }}
    >
      <DocxWorkbench tab={tab} active={active} savedRevision={savedRevision} />
    </DocxEditor.Root>
  )
}

function DocxWorkbench({ tab, active, savedRevision }: EditorProps & { savedRevision: React.MutableRefObject<number | null> }) {
  const editor = useDocxEditor()
  const page = useEditorState((s) => s.page)
  const zoom = useZoom()
  const search = useDocumentSearch()
  const [findOpen, setFindOpen] = useState(false)
  const editorRef = useRef<Editor | null>(null)
  editorRef.current = editor as Editor | null
  const zoomRef = useRef(zoom)
  zoomRef.current = zoom
  const stageRef = useRef<HTMLDivElement>(null)
  usePinchZoom(stageRef, {
    getZoom: () => zoomRef.current.zoom,
    setZoom: (z) => zoomRef.current.setZoom(z),
    target: () => stageRef.current?.querySelector<HTMLElement>('.docx-content-mount') ?? null,
    min: 0.25,
    max: 4,
  })

  useEffect(
    () =>
      registerEditor(tab.id, {
        getBytes: async () => {
          const ed = editorRef.current
          if (!ed) throw new Error('The document is still loading.')
          return new Uint8Array(await ed.save())
        },
        markSaved: () => {
          savedRevision.current = editorRef.current?.getDocumentHandle().revision ?? null
        },
        find: () => setFindOpen(true),
        zoom: (dir) => {
          const z = zoomRef.current
          if (dir === 'in') z.zoomIn()
          else if (dir === 'out') z.zoomOut()
          else z.auto()
        },
        print: () => printPages(),
      }),
    [tab.id, savedRevision],
  )

  useEffect(() => {
    if (active) editorRef.current?.focus()
  }, [active, editor])

  // The engine turns spellcheck off on its editable pages; turn it back on (macOS draws the
  // red underlines and offers corrections on right-click, which the engine applies).
  // It also paints a page break as a form-feed character, which WebKit draws as a "?" box; hide those.
  useEffect(() => {
    const stage = stageRef.current
    if (!stage) return
    const enable = () => stage.querySelectorAll<HTMLElement>('.docx-pages[contenteditable]').forEach((el) => el.spellcheck || (el.spellcheck = true))
    enable()
    hideBreakMarks(stage)
    // Typing mutates the pages constantly; check spellcheck at most once per frame.
    let queued = false
    const observer = new MutationObserver((records) => {
      for (const record of records) {
        if (record.type === 'attributes') hideBreakMark(record.target)
        else record.addedNodes.forEach(hideBreakMarks)
      }
      if (queued) return
      queued = true
      requestAnimationFrame(() => {
        queued = false
        enable()
      })
    })
    observer.observe(stage, { childList: true, subtree: true, attributes: true, attributeFilter: ['spellcheck', 'class'] })
    return () => observer.disconnect()
  }, [editor])

  const words = useWordCount(editor as Editor | null)
  const footer = [page && (page.total === 1 ? '1 page' : `${page.total} pages`), words != null && (words === 1 ? '1 word' : `${words.toLocaleString()} words`)].filter(Boolean).join(' · ')

  return (
    <Workbench tab={tab} left={<Outline />} leftFooter={footer ? <span>{footer}</span> : undefined} right={<Inspector tab={tab} />}>
      <div className="docx-stage" ref={stageRef}>
        <DocxEditor.Viewport className="docx-viewport">
          <DocxEditor.Content />
        </DocxEditor.Viewport>
      </div>
      <FindBar
        open={findOpen}
        onClose={() => {
          setFindOpen(false)
          search.clear()
          editorRef.current?.focus()
        }}
        onQuery={(q) => search.setQuery(q)}
        onNext={() => search.next()}
        onPrev={() => search.previous()}
        count={search.query ? search.matches.length : null}
        current={search.activeIndex >= 0 ? search.activeIndex : 0}
      />
      <div className="canvas-bar">
        <UndoRedo />
        <span className="sep" />
        {page && page.total > 0 && (
          <>
            <span className="readout">
              {page.current} / {page.total}
            </span>
            <span className="sep" />
          </>
        )}
        <IconButton label="Zoom out (⌘−)" size="sm" onClick={zoom.zoomOut} disabled={!zoom.canZoomOut}>
          <Minus size={14} />
        </IconButton>
        <button type="button" className="icon-btn sm readout" title={shortcut('Fit to window (⌘0)')} onClick={zoom.auto}>
          {formatZoom(zoom.zoom)}
        </button>
        <IconButton label="Zoom in (⌘+)" size="sm" onClick={zoom.zoomIn} disabled={!zoom.canZoomIn}>
          <Plus size={14} />
        </IconButton>
      </div>
    </Workbench>
  )
}

function UndoRedo() {
  const undo = useEditorCommand('history.undo')
  const redo = useEditorCommand('history.redo')
  return (
    <>
      <IconButton label="Undo (⌘Z)" size="sm" disabled={!undo.isEnabled} onClick={() => undo.execute()}>
        <Undo2 size={14} />
      </IconButton>
      <IconButton label="Redo (⇧⌘Z)" size="sm" disabled={!redo.isEnabled} onClick={() => redo.execute()}>
        <Redo2 size={14} />
      </IconButton>
    </>
  )
}

/** Hide the run the engine paints for a page break: a lone form feed, which WebKit draws as a "?" box. */
function hideBreakMark(node: Node) {
  const el = node.nodeType === Node.TEXT_NODE ? node.parentElement : (node as HTMLElement)
  if (el?.classList?.contains('layout-run-text') && el.textContent === '\f' && !el.classList.contains('docx-break-mark')) el.classList.add('docx-break-mark')
}

function hideBreakMarks(node: Node) {
  hideBreakMark(node)
  if (node instanceof HTMLElement) node.querySelectorAll('.layout-run-text').forEach(hideBreakMark)
}

/** Words in the document body, recounted shortly after each edit. */
function useWordCount(editor: Editor | null) {
  const [words, setWords] = useState<number | null>(null)
  const timer = useRef(0)
  const recount = () => {
    window.clearTimeout(timer.current)
    timer.current = window.setTimeout(() => {
      if (!editor) return
      try {
        let n = 0
        for (const p of editor.query({ type: 'paragraphs' })) n += countWords(p.text)
        setWords(n)
      } catch {
        // Still loading.
      }
    }, 400)
  }
  useEditorEvent('change', recount)
  useEffect(() => {
    recount()
    return () => window.clearTimeout(timer.current)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [editor])
  return words
}

const WORD = /[\p{L}\p{N}]/u
function countWords(text: string) {
  let n = 0
  for (const token of text.split(/\s+/)) if (WORD.test(token)) n++
  return n
}

function Outline() {
  const outline = useDocumentOutline()
  if (outline.isEmpty) return <div className="empty-hint">Headings in the document appear here. Use the Heading styles in the inspector to add them.</div>
  return (
    <nav className="list" aria-label="Outline">
      {outline.items.map(({ heading, depth }) => (
        <button
          key={heading.blockId}
          type="button"
          className={`list-item outline-item ${outline.selectedBlockId === heading.blockId ? 'active' : ''}`}
          style={{ paddingLeft: 8 + depth * 14 }}
          onClick={() => outline.goTo(heading.blockId)}
        >
          <span className="label" style={{ fontWeight: depth === 0 ? 550 : 400 }}>
            {heading.text || 'Untitled heading'}
          </span>
        </button>
      ))}
    </nav>
  )
}

/** A toggle bound to one of the editor's command slots. */
function CommandButton({ slot, label, children }: { slot: Parameters<typeof useEditorCommand>[0]; label: string; children: ReactNode }) {
  const cmd = useEditorCommand(slot)
  return (
    <IconButton
      label={label}
      active={cmd.isActive}
      disabled={!cmd.isEnabled}
      onMouseDown={(e) => e.preventDefault() /* keep the caret in the document */}
      onClick={() => cmd.execute()}
    >
      {children}
    </IconButton>
  )
}

const HIGHLIGHTS: { value: string; color: string }[] = [
  { value: 'yellow', color: '#ffff00' },
  { value: 'green', color: '#00ff00' },
  { value: 'cyan', color: '#00ffff' },
  { value: 'magenta', color: '#ff00ff' },
  { value: 'red', color: '#ff4d4d' },
]

function Inspector({ tab }: { tab: EditorProps['tab'] }) {
  const style = useParagraphStyle()
  const family = useFontFamily()
  const size = useEditorValueCommand('font.size')
  const color = useEditorValueCommand('text.color')
  const highlight = useEditorValueCommand('text.highlight')
  const spacing = useEditorValueCommand('list.lineSpacing')
  const alignLeft = useEditorCommand('alignment.left')
  const alignCenter = useEditorCommand('alignment.center')
  const alignRight = useEditorCommand('alignment.right')
  const alignJustify = useEditorCommand('alignment.justify')
  const pageBreak = useEditorCommand('insert.pageBreak')
  const toc = useEditorCommand('insert.toc')
  const editor = useDocxEditor()
  const [tableOpen, setTableOpen] = useState(false)

  const alignment = alignCenter.isActive ? 'center' : alignRight.isActive ? 'right' : alignJustify.isActive ? 'justify' : alignLeft.isActive ? 'left' : null
  const alignCommands = { left: alignLeft, center: alignCenter, right: alignRight, justify: alignJustify }

  // Put the most useful styles first, the rest after.
  const styleOptions = useMemo(() => {
    const preferred = ['Normal', 'Title', 'Subtitle', 'Heading 1', 'Heading 2', 'Heading 3', 'Quote']
    const sorted = [...style.options].sort((a, b) => {
      const ia = preferred.indexOf(a.name)
      const ib = preferred.indexOf(b.name)
      return (ia === -1 ? 99 : ia) - (ib === -1 ? 99 : ib) || a.name.localeCompare(b.name)
    })
    return sorted.map((o) => ({ value: o.styleId, label: o.name }))
  }, [style.options])

  return (
    <>
      <InspectorHeader kind="docx">Document</InspectorHeader>
      <Section title="Text">
        <SelectField value={style.value} options={styleOptions} onChange={style.setValue} disabled={!style.isEnabled} placeholder="Style" />
        <div className="docx-font-row">
          <SelectField value={family.value} options={family.options.map((f) => ({ value: f, label: f }))} onChange={family.setValue} disabled={!family.isEnabled} placeholder="Font" />
          <NumberField
            label={<span className="faint">pt</span>}
            // The editor speaks half-points (Word's unit); show points.
            value={size.value != null ? Number(size.value) / 2 : null}
            precision={1}
            step={1}
            min={1}
            max={400}
            disabled={!size.isEnabled}
            onCommit={(v) => size.execute(Math.round(v * 2))}
          />
        </div>
        <div className="toggle-row">
          <CommandButton slot="text.bold" label="Bold (⌘B)">
            <Bold size={15} />
          </CommandButton>
          <CommandButton slot="text.italic" label="Italic (⌘I)">
            <Italic size={15} />
          </CommandButton>
          <CommandButton slot="text.underline" label="Underline (⌘U)">
            <Underline size={15} />
          </CommandButton>
          <CommandButton slot="text.strike" label="Strikethrough">
            <Strikethrough size={15} />
          </CommandButton>
          <CommandButton slot="script.super" label="Superscript">
            <Superscript size={15} />
          </CommandButton>
          <CommandButton slot="script.sub" label="Subscript">
            <Subscript size={15} />
          </CommandButton>
          <CommandButton slot="format.clear" label="Clear formatting">
            <RemoveFormatting size={15} />
          </CommandButton>
        </div>
        <div className="docx-color-row">
          <ColorField value={color.value} onChange={(hex) => color.execute(hex)} disabled={!color.isEnabled} label="Color" />
          <div className="swatches highlight-swatches" title="Highlight">
            {HIGHLIGHTS.map((h) => (
              <button
                key={h.value}
                type="button"
                aria-label={`Highlight ${h.value}`}
                className={`swatch ${highlight.value === h.value ? 'on' : ''}`}
                style={{ background: h.color }}
                disabled={!highlight.isEnabled}
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => highlight.execute(highlight.value === h.value ? 'none' : h.value)}
              />
            ))}
          </div>
        </div>
      </Section>

      <Section title="Paragraph">
        <Segmented
          value={alignment}
          onChange={(v) => alignCommands[v].execute()}
          options={[
            { value: 'left', icon: <AlignLeft size={15} />, title: 'Align left' },
            { value: 'center', icon: <AlignCenter size={15} />, title: 'Center' },
            { value: 'right', icon: <AlignRight size={15} />, title: 'Align right' },
            { value: 'justify', icon: <AlignJustify size={15} />, title: 'Justify' },
          ]}
        />
        <div className="toggle-row">
          <CommandButton slot="list.bullet" label="Bulleted list">
            <List size={15} />
          </CommandButton>
          <CommandButton slot="list.numbered" label="Numbered list">
            <ListOrdered size={15} />
          </CommandButton>
          <CommandButton slot="list.outdent" label="Decrease indent">
            <IndentDecrease size={15} />
          </CommandButton>
          <CommandButton slot="list.indent" label="Increase indent">
            <IndentIncrease size={15} />
          </CommandButton>
        </div>
        <SelectField
          label="Line spacing"
          value={spacing.value != null ? String(spacing.value) : null}
          options={(spacing.options.length ? spacing.options : [1, 1.15, 1.5, 2]).map((v) => ({ value: String(v), label: String(v) }))}
          onChange={(v) => spacing.execute(Number(v))}
          disabled={!spacing.isEnabled}
        />
      </Section>

      <Section title="Insert">
        <div className="insert-grid">
          <button type="button" className="tool-btn" onClick={() => setTableOpen(!tableOpen)} aria-expanded={tableOpen}>
            <Table size={15} />
            <span>Table</span>
          </button>
          <ImageInsertTrigger className="tool-btn">
            <ImageIcon size={15} />
            <span>Image</span>
          </ImageInsertTrigger>
          <LinkButton />
          <button type="button" className="tool-btn" disabled={!pageBreak.isEnabled} onMouseDown={(e) => e.preventDefault()} onClick={() => pageBreak.execute()}>
            <FileStack size={15} />
            <span>Break</span>
          </button>
          <button type="button" className="tool-btn" disabled={!toc.isEnabled} onMouseDown={(e) => e.preventDefault()} onClick={() => toc.execute()}>
            <ListTree size={15} />
            <span>Contents</span>
          </button>
        </div>
        {tableOpen && (
          <TableSizePicker
            onPick={(rows, cols) => {
              setTableOpen(false)
              editor?.exec({ type: 'insertTable', rows, cols } as EditorCommand)
              editor?.focus()
            }}
          />
        )}
      </Section>

      <TableSection />

      <PageSection />
      <Section title="File" collapsible defaultOpen={false}>
        <p className="faint" style={{ margin: 0, fontSize: 12 }}>
          {tab.path ? tab.path.replace(/^\/Users\/[^/]+/, '~') : 'Not saved yet'}
        </p>
      </Section>
    </>
  )
}

/** Opens the engine's link popover for the selection, like ⌘K. */
function LinkButton() {
  const editor = useDocxEditor()
  const { openAtCaret } = useHyperlinkPopup()
  // Re-check whenever the selection moves.
  useEditorState((s) => s.selection)
  const probe = chromeProbeForSlot('text.link')
  const enabled = !!editor && !!probe && editor.can(probe).ok
  return (
    <button
      type="button"
      className="tool-btn"
      disabled={!enabled}
      title={enabled ? shortcut('Link (⌘K)') : 'Select some text to link'}
      onMouseDown={(e) => e.preventDefault()}
      onClick={openAtCaret}
    >
      <Link size={15} />
      <span>Link</span>
    </button>
  )
}

/**
 * The engine's link popover, with two fixes. It refuses addresses typed without a scheme
 * ("example.com"), so Apply adds https:// (or mailto:) first. And it writes the link without
 * Word's Hyperlink style, so the text would look plain; Apply also makes it blue and underlined.
 */
function LinkPopover() {
  const editor = useDocxEditor()
  const { state, setUrl, commitEdit } = useHyperlinkPopup()
  const textColor = useEditorValueCommand('text.color')
  const [applyRequest, setApplyRequest] = useState(0)
  // Closed from its own buttons or keys: put the caret back in the document.
  const refocus = useRef(false)
  useEffect(() => {
    if (!applyRequest || !editor) return
    const before = textColor.value
    // Style first: once the link is in, the selection has collapsed to its end.
    const group = editor.beginHistoryGroup()
    const styled = styleAsLink(editor, group)
    group.end()
    if (commitEdit()) {
      // Text typed straight after the link should not carry on blue and underlined.
      if (styled) endLinkStyle(editor, before)
    } else if (styled) {
      editor.exec({ type: 'undo' })
    }
    // Runs once per Apply, after the completed address has reached the popover's state.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [applyRequest])
  useEffect(() => {
    if (state.mode !== 'closed' || !refocus.current) return
    refocus.current = false
    editor?.focus()
  }, [state.mode, editor])
  const apply = (e: React.SyntheticEvent) => {
    e.preventDefault()
    e.stopPropagation()
    refocus.current = true
    const url = state.url.trim()
    if (url && !url.startsWith('#') && !/^[a-z][a-z0-9+.-]*:/i.test(url)) setUrl(/^[^\s@/]+@[^\s@/]+\.[^\s@/]+$/.test(url) ? `mailto:${url}` : `https://${url}`)
    setApplyRequest((n) => n + 1)
  }
  return (
    <div
      style={{ display: 'contents' }}
      onClickCapture={(e) => {
        const target = e.target as HTMLElement
        if (target.closest('.docx-hyperlink-popup__apply')) apply(e)
        else if (target.closest('button')) refocus.current = true
      }}
      onKeyDownCapture={(e) => {
        if (e.key === 'Enter' && state.mode === 'editing') apply(e)
        else if (e.key === 'Escape') refocus.current = true
      }}
    >
      <DocxEditor.HyperLink />
    </div>
  )
}

const LINK_COLOR = '0563C1'

/** Color and underline the selected text, as Word's Hyperlink style would. Answers whether it did. */
function styleAsLink(editor: Editor, historyGroup: ReturnType<Editor['beginHistoryGroup']>) {
  if (!editor.query({ type: 'selectedText' })) return false
  const color = commandForSlotValue('text.color', LINK_COLOR)
  const underline = commandForSlot('text.underline')
  if (color) editor.exec(color, { historyGroup })
  if (underline && !editor.isActive(underline)) editor.exec(underline, { historyGroup })
  return true
}

/** At the caret after a new link, go back to the text's own color and no underline. */
function endLinkStyle(editor: Editor, color: unknown) {
  const restore = commandForSlotValue('text.color', typeof color === 'string' && color ? color : 'auto')
  const underline = commandForSlot('text.underline')
  if (restore) editor.exec(restore)
  if (underline && editor.isActive(underline)) editor.exec(underline)
}

const BLACK_BORDER = { style: 'single', size: 4, color: { kind: 'hex', value: '000000' } } as const

const CELL_FILLS = ['FFFFFF', 'F2F2F2', 'D9D9D9', 'DCE6F2', 'DFF0D8', 'FCF3CF', 'F8D7DA', '1F2937']

/** Shown while the caret is in a table: add and remove rows and columns, shading and borders. */
function TableSection() {
  const editor = useDocxEditor()
  const table = useEditorState((s) => s.table)
  if (!editor || !table) return null
  const can = (command: EditorCommand) => editor.can(command).ok
  const run = (command: EditorCommand) => {
    editor.exec(command)
    editor.focus()
  }
  const button = (command: EditorCommand, label: string, icon: ReactNode) => (
    <IconButton label={label} disabled={!can(command)} onMouseDown={(e) => e.preventDefault()} onClick={() => run(command)}>
      {icon}
    </IconButton>
  )
  return (
    <Section title={`Table · ${table.rows} × ${table.columns}`}>
      <span className="field-caption">Rows</span>
      <div className="toggle-row">
        {button({ type: 'insertRow', where: 'above' }, 'Insert row above', <ArrowUpToLine size={15} />)}
        {button({ type: 'insertRow', where: 'below' }, 'Insert row below', <ArrowDownToLine size={15} />)}
        {button({ type: 'deleteRow' }, 'Delete row', <Minus size={15} />)}
      </div>
      <span className="field-caption">Columns</span>
      <div className="toggle-row">
        {button({ type: 'insertColumn', where: 'left' }, 'Insert column left', <ArrowLeftToLine size={15} />)}
        {button({ type: 'insertColumn', where: 'right' }, 'Insert column right', <ArrowRightToLine size={15} />)}
        {button({ type: 'deleteColumn' }, 'Delete column', <Minus size={15} />)}
      </div>
      <span className="field-caption">Shading and borders (selected cells)</span>
      <div className="swatches">
        {CELL_FILLS.map((c) => (
          <button
            key={c}
            type="button"
            aria-label={`Shade #${c}`}
            className="swatch"
            style={{ background: `#${c}` }}
            onMouseDown={(e) => e.preventDefault()}
            onClick={() => run({ type: 'setCellFill', color: c === 'FFFFFF' ? null : { kind: 'hex', value: c } })}
          />
        ))}
      </div>
      <div className="grid-3">
        <button type="button" className="btn" onMouseDown={(e) => e.preventDefault()} onClick={() => run({ type: 'setTableBorders', scope: 'all', spec: BLACK_BORDER })}>
          All
        </button>
        <button type="button" className="btn" onMouseDown={(e) => e.preventDefault()} onClick={() => run({ type: 'setTableBorders', scope: 'outside', spec: BLACK_BORDER })}>
          Outside
        </button>
        <button type="button" className="btn" onMouseDown={(e) => e.preventDefault()} onClick={() => run({ type: 'setTableBorders', scope: 'none', target: 'all' })}>
          None
        </button>
      </div>
      <button type="button" className="btn danger block" disabled={!can({ type: 'deleteTable' })} onMouseDown={(e) => e.preventDefault()} onClick={() => run({ type: 'deleteTable' })}>
        <Trash2 size={14} /> Delete table
      </button>
      <p className="faint hint">Drag a column edge in the table to resize it.</p>
    </Section>
  )
}

const TWIPS_PER_INCH = 1440
const PAPER: Record<string, [number, number]> = {
  letter: [12240, 15840],
  a4: [11906, 16838],
  legal: [12240, 20160],
  a5: [8391, 11906],
}

function PageSection() {
  const { pageSetup, apply, isEnabled } = usePageSetup()
  if (!pageSetup) return null
  const [short, long] = [Math.min(pageSetup.pageWidthTwips, pageSetup.pageHeightTwips), Math.max(pageSetup.pageWidthTwips, pageSetup.pageHeightTwips)]
  const paper = Object.entries(PAPER).find(([, [w, h]]) => Math.abs(w - short) < 40 && Math.abs(h - long) < 40)?.[0] ?? null
  const m = pageSetup.marginsTwips
  const inches = (t: number) => t / TWIPS_PER_INCH

  return (
    <Section title="Page" collapsible>
      <div className="grid-2">
        <SelectField
          value={paper}
          placeholder="Custom"
          disabled={!isEnabled}
          options={[
            { value: 'letter', label: 'US Letter' },
            { value: 'a4', label: 'A4' },
            { value: 'legal', label: 'US Legal' },
            { value: 'a5', label: 'A5' },
          ]}
          onChange={(v) => {
            const [w, h] = PAPER[v]
            const landscape = pageSetup.orientation === 'landscape'
            apply({ pageWidthTwips: landscape ? h : w, pageHeightTwips: landscape ? w : h, scope: 'document' })
          }}
        />
        <Segmented
          value={pageSetup.orientation}
          disabled={!isEnabled}
          onChange={(o) => apply({ orientation: o, pageWidthTwips: pageSetup.pageHeightTwips, pageHeightTwips: pageSetup.pageWidthTwips, scope: 'document' })}
          options={[
            { value: 'portrait', label: 'Tall', title: 'Portrait' },
            { value: 'landscape', label: 'Wide', title: 'Landscape' },
          ]}
        />
      </div>
      <span className="field-caption">Margins (inches)</span>
      <div className="grid-2">
        <NumberField label="T" value={inches(m.top)} precision={2} step={0.25} min={0} onCommit={(v) => apply({ marginTopTwips: Math.round(v * TWIPS_PER_INCH), scope: 'document' })} />
        <NumberField label="B" value={inches(m.bottom)} precision={2} step={0.25} min={0} onCommit={(v) => apply({ marginBottomTwips: Math.round(v * TWIPS_PER_INCH), scope: 'document' })} />
        <NumberField label="L" value={inches(m.left)} precision={2} step={0.25} min={0} onCommit={(v) => apply({ marginLeftTwips: Math.round(v * TWIPS_PER_INCH), scope: 'document' })} />
        <NumberField label="R" value={inches(m.right)} precision={2} step={0.25} min={0} onCommit={(v) => apply({ marginRightTwips: Math.round(v * TWIPS_PER_INCH), scope: 'document' })} />
      </div>
    </Section>
  )
}

/** Clone the laid-out pages into the print root at their true size, then open the print panel. */
async function printPages() {
  const root = document.getElementById('print-root')!
  root.innerHTML = ''
  const view = document.querySelector(".view[data-active='true'] .docx-viewport")
  const pages = view ? Array.from(view.querySelectorAll<HTMLElement>('.docx-page')) : []
  if (!pages.length) return
  // Match the paper size of the document (layout is at 96 px per inch, as is CSS).
  const first = pages[0]
  const style = document.createElement('style')
  style.textContent = `@page { size: ${first.offsetWidth}px ${first.offsetHeight}px; margin: 0; }`
  root.appendChild(style)
  for (const page of pages) {
    const wrap = document.createElement('div')
    wrap.className = 'print-page docx-print-page'
    const clone = page.cloneNode(true) as HTMLElement
    clone.style.position = 'relative'
    clone.style.inset = 'auto'
    clone.style.transform = 'none'
    clone.style.margin = '0'
    clone.style.boxShadow = 'none'
    wrap.appendChild(clone)
    root.appendChild(wrap)
  }
  window.print()
}

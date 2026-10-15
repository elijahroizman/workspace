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
  useEditorState,
  useEditorValueCommand,
  useFontFamily,
  useFonts,
  usePageSetup,
  useParagraphStyle,
  useZoom,
} from '@docx-editor.dev/react'
import {
  AlignCenter,
  AlignJustify,
  AlignLeft,
  AlignRight,
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
  Underline,
  Undo2,
} from 'lucide-react'
import type { ReactNode } from 'react'
import { useEffect, useMemo, useRef, useState } from 'react'
import type { EditorProps } from '../../App'
import { FindBar, InspectorHeader, Workbench, formatZoom } from '../../components/Workbench'
import { ColorField, IconButton, NumberField, Section, Segmented, SelectField } from '../../components/ui'
import { usePinchZoom } from '../../lib/pinch'
import { shortcut } from '../../lib/platform'
import { registerEditor, useWorkspace } from '../../state/workspace'
import './docx.css'

// One font resolver for every Word tab, so each face is fetched and parsed once.
const FONTS = packagedFonts()

export default function DocxTab({ tab, active }: EditorProps) {
  const fonts = useFonts(FONTS)
  const document = useMemo(() => tab.bytes ?? ('blank' as const), [tab.bytes])
  const savedRevision = useRef<number | null>(null)
  const markDirty = useWorkspace((s) => s.markDirty)

  return (
    <DocxEditor.Root
      document={document}
      fonts={fonts}
      mode="edit"
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
  useEffect(() => {
    const stage = stageRef.current
    if (!stage) return
    const enable = () => stage.querySelectorAll<HTMLElement>('.docx-pages[contenteditable]').forEach((el) => el.spellcheck || (el.spellcheck = true))
    enable()
    // Typing mutates the pages constantly; check at most once per frame.
    let queued = false
    const observer = new MutationObserver(() => {
      if (queued) return
      queued = true
      requestAnimationFrame(() => {
        queued = false
        enable()
      })
    })
    observer.observe(stage, { childList: true, subtree: true, attributes: true, attributeFilter: ['spellcheck'] })
    return () => observer.disconnect()
  }, [editor])

  return (
    <Workbench tab={tab} left={<Outline />} leftFooter={page ? <span>{page.total === 1 ? '1 page' : `${page.total} pages`}</span> : undefined} right={<Inspector tab={tab} />}>
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
  const link = useEditorCommand('text.link')
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
          <button type="button" className="tool-btn" disabled={!link.isEnabled} onMouseDown={(e) => e.preventDefault()} onClick={() => link.execute()}>
            <Link size={15} />
            <span>Link</span>
          </button>
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
          <div className="table-grid-wrap" onClick={(e) => (e.target as HTMLElement).closest('button') && setTableOpen(false)}>
            <DocxEditor.Menu.TableGrid slot="table.insert" />
          </div>
        )}
      </Section>

      <PageSection />
      <Section title="File" collapsible defaultOpen={false}>
        <p className="faint" style={{ margin: 0, fontSize: 12 }}>
          {tab.path ? tab.path.replace(/^\/Users\/[^/]+/, '~') : 'Not saved yet'}
        </p>
      </Section>
    </>
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

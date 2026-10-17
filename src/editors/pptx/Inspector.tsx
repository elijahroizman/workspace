import {
  AlignCenter,
  AlignCenterHorizontal,
  AlignCenterVertical,
  AlignEndHorizontal,
  AlignEndVertical,
  AlignJustify,
  AlignLeft,
  AlignRight,
  AlignStartHorizontal,
  AlignStartVertical,
  ArrowDownToLine,
  ArrowUpToLine,
  Bold,
  BringToFront,
  Circle,
  Copy,
  Diamond,
  EyeOff,
  FlipHorizontal2,
  FlipVertical2,
  Group,
  Image as ImageIcon,
  Italic,
  Link,
  List,
  ListOrdered,
  Minus,
  MoveDown,
  MoveRight,
  MoveUp,
  Play,
  Plus,
  RectangleHorizontal,
  SendToBack,
  Shapes,
  Square,
  Star,
  Strikethrough,
  Table,
  Trash2,
  Triangle,
  Type,
  Underline,
  Ungroup,
  Video,
} from 'lucide-react'
import type { ReactNode } from 'react'
import { useEffect, useRef, useState } from 'react'
import { InspectorHeader } from '../../components/Workbench'
import type { MenuEntry } from '../../components/ui'
import * as platform from '../../lib/platform'
import { withKeys } from '../../state/shortcuts'
import { ColorField, IconButton, NumberField, PopoverMenu, Section, Segmented, SelectField, TableSizePicker, normalizeHex } from '../../components/ui'
import type { Restack } from './arrange'
import { mapPicked, pickedText, styleShape, styleText, withElements } from './arrange'
import { SlidePreview } from './SlideStrip'
import { SlideSwap } from './SlideSwap'
import type { TableData, TableElement, TableLook } from './table'
import { TABLE_LOOKS, applyLook, currentLook, fitRowsTo, isTable, resizeColumns, resizeRows, rowsHeight, styleAllCells, themeLook } from './table'
import { DIRECTIONS, TRANSITIONS, changeTransition } from './transitions'
import type { Deck, Element, ShapeKind, ShapeStyle, Slide, TextStyle, Transition } from './types'
import { hasText, linkOf, shapeStyleOf } from './types'

const SHAPES: { kind: ShapeKind; label: string; icon: ReactNode }[] = [
  { kind: 'rect', label: 'Rectangle', icon: <Square size={14} /> },
  { kind: 'roundRect', label: 'Rounded rectangle', icon: <RectangleHorizontal size={14} /> },
  { kind: 'ellipse', label: 'Oval', icon: <Circle size={14} /> },
  { kind: 'triangle', label: 'Triangle', icon: <Triangle size={14} /> },
  { kind: 'diamond', label: 'Diamond', icon: <Diamond size={14} /> },
  { kind: 'star5', label: 'Star', icon: <Star size={14} /> },
  { kind: 'rtArrow', label: 'Arrow', icon: <MoveRight size={14} /> },
  { kind: 'line', label: 'Line', icon: <Minus size={14} /> },
]

const FONTS = ['Helvetica Neue', 'Arial', 'Avenir Next', 'Calibri', 'Futura', 'Georgia', 'Gill Sans', 'Inter', 'Menlo', 'Times New Roman', 'Verdana']
const SWATCHES = ['FFFFFF', '000000', '6B6B70', '4F8CFF', 'FF8A3D', 'F2555A', '3ECF8E', 'A98BFF', 'F5A524']

export function Inspector({
  deck,
  onInsertImage,
  onInsertTable,
  onInsertVideo,
  onNewSlide,
  onPresent,
  onDeleteSlides,
  onArrange,
  canArrange,
}: {
  deck: Deck
  onInsertImage: () => void
  onInsertTable: (rows: number, cols: number) => void
  onInsertVideo: (url: string) => Promise<boolean>
  onNewSlide: (anchor: { x: number; y: number }) => void
  onPresent: (fromStart: boolean) => void
  onDeleteSlides: (indexes: readonly number[]) => void
  onArrange: (how: Restack) => void
  canArrange: (how: Restack) => boolean
}) {
  const { tb, handle, slides, activeIndex, selectedSlides } = deck
  const [shapeMenu, setShapeMenu] = useState<{ x: number; y: number } | null>(null)
  const [videoOpen, setVideoOpen] = useState(false)
  const [tableOpen, setTableOpen] = useState(false)
  const el = tb.selectedElement
  const count = tb.selectedCount
  const slide = slides[activeIndex]

  const update = (patch: Partial<Element>) => el && handle.current?.updateElement(el.id, patch)

  return (
    <>
      <InspectorHeader kind="pptx">Presentation</InspectorHeader>

      <Section title="Insert">
        <div className="insert-grid">
          <ToolButton icon={<Type size={15} />} label="Text" onClick={tb.onAddTextBox} />
          <ToolButton
            icon={<Shapes size={15} />}
            label="Shape"
            onClick={(e) => {
              const r = e.currentTarget.getBoundingClientRect()
              setShapeMenu({ x: r.left, y: r.bottom + 4 })
            }}
          />
          <ToolButton icon={<Table size={15} />} label="Table" active={tableOpen} onClick={() => setTableOpen(!tableOpen)} />
          <ToolButton icon={<ImageIcon size={15} />} label="Image" onClick={onInsertImage} />
          <ToolButton icon={<Video size={15} />} label="Video" active={videoOpen} onClick={() => setVideoOpen(!videoOpen)} />
          <ToolButton
            icon={<Plus size={15} />}
            label="Slide"
            onClick={(e) => {
              const r = e.currentTarget.getBoundingClientRect()
              onNewSlide({ x: r.left, y: r.bottom + 4 })
            }}
          />
        </div>
        {tableOpen && (
          <TableSizePicker
            max={{ rows: 12, cols: 10 }}
            onPick={(rows, cols) => {
              setTableOpen(false)
              onInsertTable(rows, cols)
            }}
          />
        )}
        {videoOpen && (
          <UrlField
            placeholder="Paste a YouTube or Vimeo link"
            submitLabel="Add"
            onSubmit={async (url) => {
              if (await onInsertVideo(url)) setVideoOpen(false)
            }}
          />
        )}
      </Section>

      {count > 1 ? (
        <MultiSelection deck={deck} count={count} onArrange={onArrange} canArrange={canArrange} />
      ) : el ? (
        <>
          {isTable(el) && <TableSection deck={deck} el={el} />}
          {el.type === 'group' && <GroupTextSection deck={deck} />}
          {hasText(el) && <TextSection deck={deck} el={el} />}
          {(el.type === 'shape' || el.type === 'text' || el.type === 'connector') && <FillSection deck={deck} el={el} />}
          <ArrangeSection deck={deck} el={el} update={update} onArrange={onArrange} canArrange={canArrange} />
          <LinkSection el={el} update={update} />
        </>
      ) : selectedSlides.length > 1 ? (
        <>
          <Section title={`${selectedSlides.length} slides`}>
            <div className="grid-2">
              <button type="button" className="btn" onClick={() => handle.current?.duplicateSlides([...selectedSlides])}>
                <Copy size={14} /> Duplicate
              </button>
              <button type="button" className="btn danger" disabled={selectedSlides.length >= slides.length} onClick={() => onDeleteSlides(selectedSlides)}>
                <Trash2 size={14} /> Delete
              </button>
            </div>
            <button type="button" className="btn block" onClick={() => handle.current?.toggleHideSlides([...selectedSlides])}>
              <EyeOff size={14} /> Hide or show in slideshow
            </button>
            <p className="faint hint">Shift-click picks a run of slides; {platform.isMac ? '⌘' : 'Ctrl'}-click adds or removes one.</p>
          </Section>
          <TransitionSection deck={deck} indexes={selectedSlides} />
        </>
      ) : (
        slide && (
          <>
          <Section title={`Slide ${activeIndex + 1} of ${slides.length}`}>
            {tb.layoutOptions.length > 1 && tb.onApplyLayout && (
              <SelectField
                label="Layout"
                value={tb.currentLayoutPath ?? null}
                options={tb.layoutOptions.map((l) => ({ value: l.path, label: l.name }))}
                onChange={(path) => tb.onApplyLayout?.(path)}
              />
            )}
            <div className="grid-2">
              <button type="button" className="btn" onClick={() => handle.current?.duplicateSlides([activeIndex])}>
                <Copy size={14} /> Duplicate
              </button>
              <button type="button" className="btn danger" disabled={slides.length <= 1} onClick={() => handle.current?.deleteSlides([activeIndex])}>
                <Trash2 size={14} /> Delete
              </button>
              <button type="button" className="btn" disabled={activeIndex === 0} onClick={() => handle.current?.moveSlide(activeIndex, activeIndex - 1)}>
                <ArrowUpToLine size={14} /> Move up
              </button>
              <button type="button" className="btn" disabled={activeIndex >= slides.length - 1} onClick={() => handle.current?.moveSlide(activeIndex, activeIndex + 1)}>
                <ArrowDownToLine size={14} /> Move down
              </button>
            </div>
            <button type="button" className="btn block" onClick={() => tb.onToggleHideSlide?.()}>
              <EyeOff size={14} /> {slide.hidden ? 'Show slide in slideshow' : 'Hide slide in slideshow'}
            </button>
            <p className="faint hint">Drag across the slide or shift-click to select several objects. Double-click text to edit it.</p>
          </Section>
          <TransitionSection deck={deck} indexes={[activeIndex]} />
          </>
        )
      )}

      <Section title="Present">
        <button type="button" className="btn primary block" disabled={!slides.length} onClick={() => onPresent(false)}>
          <Play size={14} /> Play from this slide
        </button>
        <button type="button" className="btn block" disabled={!slides.length} onClick={() => onPresent(true)}>
          Play from start
        </button>
      </Section>

      {shapeMenu && (
        <PopoverMenu
          anchor={shapeMenu}
          onClose={() => setShapeMenu(null)}
          items={SHAPES.map<MenuEntry>((s) => ({
            label: s.label,
            icon: s.icon,
            onSelect: () => {
              tb.onSetNewShapeType(s.kind)
              // The engine reads the new shape type on its next render.
              requestAnimationFrame(() => deck.tbRef.current?.onAddShape())
            },
          }))}
        />
      )}
    </>
  )
}

function ToolButton({ icon, label, onClick, active }: { icon: ReactNode; label: string; onClick: (e: React.MouseEvent<HTMLButtonElement>) => void; active?: boolean }) {
  return (
    <button type="button" className={`tool-btn ${active ? 'on' : ''}`} onMouseDown={(e) => e.preventDefault()} onClick={onClick}>
      {icon}
      <span>{label}</span>
    </button>
  )
}

function UrlField({ placeholder, submitLabel, initial = '', onSubmit, onClear }: { placeholder: string; submitLabel: string; initial?: string; onSubmit: (url: string) => void; onClear?: () => void }) {
  const [value, setValue] = useState(initial)
  const [busy, setBusy] = useState(false)
  useEffect(() => setValue(initial), [initial])
  const submit = async () => {
    if (!value.trim()) return
    setBusy(true)
    try {
      await onSubmit(value.trim())
    } finally {
      setBusy(false)
    }
  }
  return (
    <div className="url-field">
      <label className="field">
        <Link size={13} className="faint" />
        <input
          value={value}
          placeholder={placeholder}
          spellCheck={false}
          autoFocus={!initial}
          onChange={(e) => setValue(e.currentTarget.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') void submit()
          }}
        />
      </label>
      <div className="row">
        <button type="button" className="btn primary" disabled={!value.trim() || busy} onClick={() => void submit()}>
          {busy ? 'Adding…' : submitLabel}
        </button>
        {onClear && initial && (
          <button type="button" className="btn" onClick={onClear}>
            Remove
          </button>
        )}
      </div>
    </div>
  )
}

/** Looks offered for tables: the deck's own accent first, when it has one. */
export function tableLooks(deck: Deck): TableLook[] {
  const theme = themeLook(deck.tb.templateScheme?.accent1)
  return theme ? [theme, ...TABLE_LOOKS] : TABLE_LOOKS
}

function TableSection({ deck, el }: { deck: Deck; el: TableElement }) {
  const { handle, tb } = deck
  const data = el.tableData
  const looks = tableLooks(deck)

  // Dragging the frame taller or shorter stretches the rows to fill it, as in PowerPoint.
  const last = useRef<{ id: string; height: number } | null>(null)
  useEffect(() => {
    const prev = last.current
    last.current = { id: el.id, height: el.height }
    if (!data || !prev || prev.id !== el.id || prev.height === el.height) return
    if (Math.abs(rowsHeight(data) - el.height) > 1) handle.current?.updateElement(el.id, { tableData: fitRowsTo(data, el.height) } as Partial<Element>)
  }, [el.id, el.height, data, handle])

  if (!data) return null
  const look = currentLook(data, looks)
  const header = data.firstRowHeader !== false
  const banded = data.bandedRows !== false
  const first = data.rows[0]?.cells[0]?.style
  const fonts = Array.from(new Set([tb.themeFonts?.body, tb.themeFonts?.heading, ...FONTS].filter(Boolean) as string[]))

  const commit = (next: TableData) => {
    const height = rowsHeight(next)
    handle.current?.updateElement(el.id, { tableData: next, ...(height ? { height } : {}) } as Partial<Element>)
    last.current = { id: el.id, height: height || el.height }
  }
  const restyle = (next: TableData) => (look ? applyLook(next, look, { header: next.firstRowHeader !== false, banded: next.bandedRows !== false }) : next)

  return (
    <Section title={`Table · ${data.rows.length} × ${data.columnWidths.length}`}>
      <div className="table-looks">
        {looks.map((l) => (
          <button
            key={l.id}
            type="button"
            title={l.label}
            aria-label={`${l.label} table style`}
            className={`table-look ${look?.id === l.id ? 'on' : ''}`}
            onClick={() => commit(applyLook(data, l, { header, banded }))}
          >
            <span style={{ background: l.header, borderBottom: l.open ? `1.5px solid ${l.text}` : undefined }} />
            <span style={{ background: l.band, boxShadow: `inset 0 -1px ${l.line}` }} />
            <span style={{ background: l.body, boxShadow: `inset 0 -1px ${l.line}` }} />
            <span style={{ background: l.band }} />
          </button>
        ))}
      </div>
      <div className="grid-2">
        <button type="button" className={`btn ${header ? 'active-chip' : ''}`} onClick={() => commit(restyle({ ...data, firstRowHeader: !header }))}>
          Header row
        </button>
        <button type="button" className={`btn ${banded ? 'active-chip' : ''}`} onClick={() => commit(restyle({ ...data, bandedRows: !banded }))}>
          Banded rows
        </button>
      </div>
      <div className="grid-2">
        <Stepper label="Rows" value={data.rows.length} min={1} max={50} onChange={(n) => commit(restyle(resizeRows(data, n)))} />
        <Stepper label="Columns" value={data.columnWidths.length} min={1} max={20} onChange={(n) => commit(restyle(resizeColumns(data, n)))} />
      </div>
      <div className="docx-font-row">
        <SelectField value={first?.fontFamily ?? null} placeholder="Theme font" options={fonts.map((f) => ({ value: f, label: f }))} onChange={(f) => commit(styleAllCells(data, { fontFamily: f }))} />
        <NumberField label={<span className="faint">pt</span>} value={first?.fontSize ?? null} precision={1} min={4} max={200} onCommit={(v) => commit(styleAllCells(data, { fontSize: v }))} />
      </div>
      <Segmented
        value={first?.align === 'center' || first?.align === 'right' ? first.align : 'left'}
        onChange={(a) => commit(styleAllCells(data, { align: a }))}
        options={[
          { value: 'left', icon: <AlignLeft size={15} />, title: 'Align left' },
          { value: 'center', icon: <AlignCenter size={15} />, title: 'Center' },
          { value: 'right', icon: <AlignRight size={15} />, title: 'Align right' },
        ]}
      />
      <p className="faint hint">Double-click a cell to type in it. Drag the frame to resize the table.</p>
    </Section>
  )
}

function Stepper({ label, value, min, max, onChange }: { label: string; value: number; min: number; max: number; onChange: (n: number) => void }) {
  return (
    <div className="stepper">
      <span className="field-label">{label}</span>
      <IconButton label={`Fewer ${label.toLowerCase()}`} size="sm" disabled={value <= min} onClick={() => onChange(value - 1)}>
        <Minus size={13} />
      </IconButton>
      <span className="stepper-value">{value}</span>
      <IconButton label={`More ${label.toLowerCase()}`} size="sm" disabled={value >= max} onClick={() => onChange(value + 1)}>
        <Plus size={13} />
      </IconButton>
    </div>
  )
}

function TextSection({ deck, el }: { deck: Deck; el: Element & { textStyle?: TextStyle } }) {
  const { tb } = deck
  const style = el.textStyle ?? {}
  const set = (patch: TextStyle) => tb.onUpdateTextStyle(patch)
  const fonts = Array.from(new Set([tb.themeFonts?.body, tb.themeFonts?.heading, ...(tb.embeddedFontFamilies ?? []), ...FONTS].filter(Boolean) as string[]))
  const align = style.align === 'center' || style.align === 'right' || style.align === 'justify' ? style.align : 'left'
  return (
    <Section title="Text">
      <div className="docx-font-row">
        <SelectField value={style.fontFamily ?? null} placeholder="Theme font" options={fonts.map((f) => ({ value: f, label: f }))} onChange={(f) => set({ fontFamily: f })} />
        <NumberField label={<span className="faint">pt</span>} value={style.fontSize ?? null} precision={1} min={1} max={400} onCommit={(v) => set({ fontSize: v })} />
      </div>
      <div className="toggle-row">
        <IconButton label={withKeys('Bold', 'text.bold')} active={!!style.bold} onMouseDown={(e) => e.preventDefault()} onClick={() => set({ bold: !style.bold })}>
          <Bold size={15} />
        </IconButton>
        <IconButton label={withKeys('Italic', 'text.italic')} active={!!style.italic} onMouseDown={(e) => e.preventDefault()} onClick={() => set({ italic: !style.italic })}>
          <Italic size={15} />
        </IconButton>
        <IconButton label={withKeys('Underline', 'text.underline')} active={!!style.underline} onMouseDown={(e) => e.preventDefault()} onClick={() => set({ underline: !style.underline })}>
          <Underline size={15} />
        </IconButton>
        <IconButton label="Strikethrough" active={!!style.strikethrough} onMouseDown={(e) => e.preventDefault()} onClick={() => set({ strikethrough: !style.strikethrough })}>
          <Strikethrough size={15} />
        </IconButton>
        <IconButton label="Bulleted list" onMouseDown={(e) => e.preventDefault()} onClick={() => tb.onToggleBullets('bullet')}>
          <List size={15} />
        </IconButton>
        <IconButton label="Numbered list" onMouseDown={(e) => e.preventDefault()} onClick={() => tb.onToggleBullets('numbered')}>
          <ListOrdered size={15} />
        </IconButton>
      </div>
      <Segmented
        value={align}
        onChange={(a) => set({ align: a })}
        options={[
          { value: 'left', icon: <AlignLeft size={15} />, title: 'Align left' },
          { value: 'center', icon: <AlignCenter size={15} />, title: 'Center' },
          { value: 'right', icon: <AlignRight size={15} />, title: 'Align right' },
          { value: 'justify', icon: <AlignJustify size={15} />, title: 'Justify' },
        ]}
      />
      <ColorField value={normalizeHex(style.color)} label="Text color" onChange={(hex) => set({ color: `#${hex}` })} />
      <Swatches value={normalizeHex(style.color)} onPick={(hex) => set({ color: `#${hex}` })} />
      <p className="faint hint">Select words while editing to style just those.</p>
    </Section>
  )
}

function FillSection({ deck, el }: { deck: Deck; el: Element }) {
  const { tb } = deck
  const s = shapeStyleOf(el) ?? {}
  const noFill = s.fillMode === 'none' || (!s.fillColor && s.fillMode !== 'solid')
  return (
    <Section title="Fill & line">
      <div className="docx-color-row">
        <ColorField value={noFill ? null : normalizeHex(s.fillColor)} label="No fill" onChange={(hex) => tb.onUpdateElementStyle({ fillMode: 'solid', fillColor: `#${hex}` })} />
        <button type="button" className={`btn ${noFill ? 'active-chip' : ''}`} onClick={() => tb.onUpdateElementStyle({ fillMode: 'none' })}>
          None
        </button>
      </div>
      <Swatches value={noFill ? null : normalizeHex(s.fillColor)} onPick={(hex) => tb.onUpdateElementStyle({ fillMode: 'solid', fillColor: `#${hex}` })} />
      <div className="grid-2">
        <ColorField value={normalizeHex(s.strokeColor)} label="No line" onChange={(hex) => tb.onUpdateElementStyle({ strokeColor: `#${hex}`, strokeWidth: s.strokeWidth || 1 })} />
        <NumberField label="W" suffix="pt" value={s.strokeWidth ?? 0} min={0} max={50} step={0.5} precision={1} onCommit={(w) => tb.onUpdateElementStyle({ strokeWidth: w })} />
      </div>
    </Section>
  )
}

function ArrangeSection({
  deck,
  el,
  update,
  onArrange,
  canArrange,
}: {
  deck: Deck
  el: Element
  update: (patch: Partial<Element>) => void
  onArrange: (how: Restack) => void
  canArrange: (how: Restack) => boolean
}) {
  const { tb } = deck
  const kind = el.type === 'text' ? 'Text box' : el.type === 'image' || el.type === 'picture' ? 'Image' : el.type[0].toUpperCase() + el.type.slice(1)
  return (
    <Section title={kind}>
      <div className="grid-2">
        <NumberField label="X" value={el.x} onCommit={(x) => update({ x })} />
        <NumberField label="Y" value={el.y} onCommit={(y) => update({ y })} />
        <NumberField label="W" value={el.width} min={1} onCommit={(width) => update({ width })} />
        <NumberField label="H" value={el.height} min={1} onCommit={(height) => update({ height })} />
        <NumberField label="∠" value={el.rotation ?? 0} suffix="°" onCommit={(r) => update({ rotation: ((r % 360) + 360) % 360 })} />
        <div className="toggle-row">
          <IconButton label="Flip horizontally" onClick={() => tb.onFlip('horizontal')}>
            <FlipHorizontal2 size={15} />
          </IconButton>
          <IconButton label="Flip vertically" onClick={() => tb.onFlip('vertical')}>
            <FlipVertical2 size={15} />
          </IconButton>
        </div>
      </div>
      <LayerButtons onArrange={onArrange} canArrange={canArrange} />
      {el.type === 'group' && (
        <button type="button" className="btn block" onClick={tb.onUngroupElement} title={platform.shortcut(withKeys('Ungroup', 'pptx.ungroup'))}>
          <Ungroup size={14} /> Ungroup
        </button>
      )}
      <div className="grid-2">
        <button type="button" className="btn" onClick={tb.onDuplicate} title={platform.shortcut(withKeys('Duplicate', 'pptx.duplicate'))}>
          <Copy size={14} /> Duplicate
        </button>
        <button type="button" className="btn danger" onClick={tb.onDelete}>
          <Trash2 size={14} /> Delete
        </button>
      </div>
    </Section>
  )
}

/** Stacking order for the selected objects, as PowerPoint's Arrange menu. */
function LayerButtons({ onArrange, canArrange }: { onArrange: (how: Restack) => void; canArrange: (how: Restack) => boolean }) {
  const layer = (how: Restack, short: string, label: string, icon: ReactNode) => (
    <button type="button" className="btn layer-btn" disabled={!canArrange(how)} title={platform.shortcut(withKeys(label, `pptx.${how}`))} aria-label={label} onClick={() => onArrange(how)}>
      {icon} {short}
    </button>
  )
  return (
    <>
      <span className="field-caption">Arrange</span>
      <div className="grid-2">
        {layer('front', 'To front', 'Bring to front', <BringToFront size={14} />)}
        {layer('back', 'To back', 'Send to back', <SendToBack size={14} />)}
        {layer('forward', 'Forward', 'Bring forward', <MoveUp size={14} />)}
        {layer('backward', 'Backward', 'Send backward', <MoveDown size={14} />)}
      </div>
    </>
  )
}

function LinkSection({ el, update }: { el: Element; update: (patch: Partial<Element>) => void }) {
  const url = linkOf(el)
  return (
    <Section title="Link" collapsible defaultOpen={!!url}>
      <UrlField
        key={el.id}
        initial={url ?? ''}
        placeholder="https://"
        submitLabel={url ? 'Update' : 'Add link'}
        onSubmit={(value) => {
          const href = /^[a-z]+:/i.test(value) ? value : `https://${value}`
          update({ actionClick: { action: '', url: href } } as Partial<Element>)
        }}
        onClear={() => update({ actionClick: undefined } as Partial<Element>)}
      />
      <p className="faint hint">Clicking this object during a slideshow opens the link. Video links play in the slide.</p>
    </Section>
  )
}

function MultiSelection({ deck, count, onArrange, canArrange }: { deck: Deck; count: number; onArrange: (how: Restack) => void; canArrange: (how: Restack) => boolean }) {
  const { tb } = deck
  return (
    <>
    <Section title={`${count} objects`}>
      <div className="grid-2">
        <button type="button" className="btn" disabled={!tb.selectionGroupable} onClick={tb.onGroupElements} title={platform.shortcut(withKeys('Group', 'pptx.group'))}>
          <Group size={14} /> Group
        </button>
        <button type="button" className="btn danger" onClick={tb.onDelete}>
          <Trash2 size={14} /> Delete
        </button>
      </div>
      <div className="toggle-row">
        <IconButton label="Align left" onClick={() => tb.onAlignElements('left')}>
          <AlignStartVertical size={15} />
        </IconButton>
        <IconButton label="Align centers" onClick={() => tb.onAlignElements('center')}>
          <AlignCenterVertical size={15} />
        </IconButton>
        <IconButton label="Align right" onClick={() => tb.onAlignElements('right')}>
          <AlignEndVertical size={15} />
        </IconButton>
        <IconButton label="Align top" onClick={() => tb.onAlignElements('top')}>
          <AlignStartHorizontal size={15} />
        </IconButton>
        <IconButton label="Align middles" onClick={() => tb.onAlignElements('middle')}>
          <AlignCenterHorizontal size={15} />
        </IconButton>
        <IconButton label="Align bottom" onClick={() => tb.onAlignElements('bottom')}>
          <AlignEndHorizontal size={15} />
        </IconButton>
      </div>
      <div className="grid-2">
        <button type="button" className="btn" disabled={!tb.canDistribute} onClick={() => tb.onDistributeElements('horizontal')}>
          Space across
        </button>
        <button type="button" className="btn" disabled={!tb.canDistribute} onClick={() => tb.onDistributeElements('vertical')}>
          Space down
        </button>
      </div>
      <LayerButtons onArrange={onArrange} canArrange={canArrange} />
    </Section>
    <GroupTextSection deck={deck} />
    <GroupFillSection deck={deck} />
    </>
  )
}

/** Text styling for every selected object that holds text, all at once (one undo step). */
function GroupTextSection({ deck }: { deck: Deck }) {
  const { tb, handle, slides, activeIndex, selectedIds } = deck
  const ids = new Set(selectedIds)
  const texts = pickedText(slides[activeIndex]?.elements ?? [], ids)
  if (!texts.length) return null
  // Show a value only when every box agrees on it.
  const shared = <K extends keyof TextStyle>(key: K) => {
    const first = texts[0].textStyle?.[key]
    return texts.every((t) => t.textStyle?.[key] === first) ? first : undefined
  }
  const set = (patch: TextStyle) => handle.current?.editSlides(withElements(activeIndex, (els) => mapPicked(els, ids, (el) => styleText(el, patch))))
  const fonts = Array.from(new Set([tb.themeFonts?.body, tb.themeFonts?.heading, ...(tb.embeddedFontFamilies ?? []), ...FONTS].filter(Boolean) as string[]))
  const all = (key: 'bold' | 'italic' | 'underline' | 'strikethrough') => texts.every((t) => !!t.textStyle?.[key])
  const color = normalizeHex(shared('color') as string | undefined)
  const align = shared('align')
  return (
    <Section title={texts.length === 1 ? 'Text' : `Text · ${texts.length} boxes`}>
      <div className="docx-font-row">
        <SelectField value={(shared('fontFamily') as string | undefined) ?? null} placeholder="Mixed fonts" options={fonts.map((f) => ({ value: f, label: f }))} onChange={(f) => set({ fontFamily: f })} />
        <NumberField label={<span className="faint">pt</span>} value={(shared('fontSize') as number | undefined) ?? null} precision={1} min={1} max={400} onCommit={(v) => set({ fontSize: v })} />
      </div>
      <div className="toggle-row">
        <IconButton label={withKeys('Bold', 'text.bold')} active={all('bold')} onClick={() => set({ bold: !all('bold') })}>
          <Bold size={15} />
        </IconButton>
        <IconButton label={withKeys('Italic', 'text.italic')} active={all('italic')} onClick={() => set({ italic: !all('italic') })}>
          <Italic size={15} />
        </IconButton>
        <IconButton label={withKeys('Underline', 'text.underline')} active={all('underline')} onClick={() => set({ underline: !all('underline') })}>
          <Underline size={15} />
        </IconButton>
        <IconButton label="Strikethrough" active={all('strikethrough')} onClick={() => set({ strikethrough: !all('strikethrough') })}>
          <Strikethrough size={15} />
        </IconButton>
      </div>
      <Segmented
        value={align === 'center' || align === 'right' || align === 'justify' || align === 'left' ? align : null}
        onChange={(a) => set({ align: a })}
        options={[
          { value: 'left', icon: <AlignLeft size={15} />, title: 'Align left' },
          { value: 'center', icon: <AlignCenter size={15} />, title: 'Center' },
          { value: 'right', icon: <AlignRight size={15} />, title: 'Align right' },
          { value: 'justify', icon: <AlignJustify size={15} />, title: 'Justify' },
        ]}
      />
      <ColorField value={color} label="Text color" onChange={(hex) => set({ color: `#${hex}` })} />
      <Swatches value={color} onPick={(hex) => set({ color: `#${hex}` })} />
    </Section>
  )
}

function GroupFillSection({ deck }: { deck: Deck }) {
  const { handle, slides, activeIndex, selectedIds } = deck
  const ids = new Set(selectedIds)
  const shapes = (slides[activeIndex]?.elements ?? []).filter((e) => ids.has(e.id) && (e.type === 'shape' || e.type === 'text'))
  if (!shapes.length) return null
  const set = (patch: Partial<ShapeStyle>) => handle.current?.editSlides(withElements(activeIndex, (els) => mapPicked(els, ids, (el) => styleShape(el, patch))))
  const fills = shapes.map((e) => shapeStyleOf(e))
  const first = normalizeHex(fills[0]?.fillMode === 'none' ? undefined : fills[0]?.fillColor)
  const value = fills.every((f) => normalizeHex(f?.fillMode === 'none' ? undefined : f?.fillColor) === first) ? first : null
  return (
    <Section title="Fill">
      <div className="docx-color-row">
        <ColorField value={value} label="Fill" onChange={(hex) => set({ fillMode: 'solid', fillColor: `#${hex}` })} />
        <button type="button" className="btn" onClick={() => set({ fillMode: 'none' })}>
          None
        </button>
      </div>
      <Swatches value={value} onPick={(hex) => set({ fillMode: 'solid', fillColor: `#${hex}` })} />
    </Section>
  )
}

/** Transition into the picked slides, with a preview played from the slide before. */
function TransitionSection({ deck, indexes }: { deck: Deck; indexes: readonly number[] }) {
  const { handle, slides, cv, templateFor } = deck
  const [run, setRun] = useState(0)
  const first = slides[indexes[0]]
  if (!first) return null
  const current = first.transition
  const type = indexes.every((i) => (slides[i]?.transition?.type ?? 'none') === (current?.type ?? 'none')) ? (current?.type ?? 'none') : null
  const option = TRANSITIONS.find((t) => t.value === type)
  const set = (change: (t: Transition | undefined) => Transition | undefined, targets: readonly number[] = indexes) => {
    handle.current?.editSlides((all) => all.map((s, i) => (targets.includes(i) ? { ...s, transition: change(s.transition) } : s)))
    setRun((r) => r + 1)
  }
  const options = TRANSITIONS.map((t) => ({ value: t.value as string, label: t.label }))
  if (type && !option) options.push({ value: type, label: type })
  const before = slides[indexes[0] - 1] as Slide | undefined
  const width = 244
  const playing = type && type !== 'none' && type !== 'cut'
  return (
    <Section title="Transition">
      <SelectField value={type} placeholder="Mixed" options={options} onChange={(v) => set((t) => changeTransition(t, v as Transition['type']))} />
      {playing && (
        <>
          <div className="grid-2">
            {option?.directions ? (
              <SelectField value={current?.direction ?? 'l'} options={DIRECTIONS} onChange={(d) => set((t) => t && { ...t, direction: d })} />
            ) : (
              <span />
            )}
            <NumberField
              label={<span className="faint">sec</span>}
              value={(current?.durationMs ?? 700) / 1000}
              precision={2}
              step={0.1}
              min={0.1}
              max={10}
              onCommit={(v) => set((t) => t && { ...t, durationMs: Math.round(v * 1000) })}
            />
          </div>
          <button type="button" className="transition-preview" style={{ height: (width * cv.canvasSize.height) / cv.canvasSize.width }} title="Play the transition" onClick={() => setRun((r) => r + 1)}>
            <SlideSwap
              run={run}
              transition={current}
              outgoing={before ? <SlidePreview slide={before} templateElements={templateFor(before)} canvasSize={cv.canvasSize} width={width} lazy={false} /> : <div className="transition-blank" />}
              incoming={<SlidePreview slide={first} templateElements={templateFor(first)} canvasSize={cv.canvasSize} width={width} lazy={false} />}
            />
          </button>
        </>
      )}
      <button type="button" className="btn block" disabled={slides.length < 2} onClick={() => set(() => current, slides.map((_, i) => i))}>
        Use on every slide
      </button>
    </Section>
  )
}

function Swatches({ value, onPick }: { value: string | null; onPick: (hex: string) => void }) {
  return (
    <div className="swatches one-line">
      {SWATCHES.map((c) => (
        <button
          key={c}
          type="button"
          aria-label={`#${c}`}
          className={`swatch ${value === c ? 'on' : ''}`}
          style={{ background: `#${c}` }}
          onMouseDown={(e) => e.preventDefault()}
          onClick={() => onPick(c)}
        />
      ))}
    </div>
  )
}

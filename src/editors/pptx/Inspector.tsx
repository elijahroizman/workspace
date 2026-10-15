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
  MoveRight,
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
  Video,
} from 'lucide-react'
import type { ReactNode } from 'react'
import { useEffect, useState } from 'react'
import { InspectorHeader } from '../../components/Workbench'
import type { MenuEntry } from '../../components/ui'
import { ColorField, IconButton, NumberField, PopoverMenu, Section, Segmented, SelectField, normalizeHex } from '../../components/ui'
import type { Deck, Element, ShapeKind, TextStyle } from './types'
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
  onInsertVideo,
  onNewSlide,
  onPresent,
}: {
  deck: Deck
  onInsertImage: () => void
  onInsertVideo: (url: string) => Promise<boolean>
  onNewSlide: (anchor: { x: number; y: number }) => void
  onPresent: (fromStart: boolean) => void
}) {
  const { tb, handle, slides, activeIndex } = deck
  const [shapeMenu, setShapeMenu] = useState<{ x: number; y: number } | null>(null)
  const [videoOpen, setVideoOpen] = useState(false)
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
          <ToolButton icon={<Table size={15} />} label="Table" onClick={tb.onAddTable} />
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
        <MultiSelection deck={deck} count={count} />
      ) : el ? (
        <>
          {hasText(el) && <TextSection deck={deck} el={el} />}
          {(el.type === 'shape' || el.type === 'text' || el.type === 'connector') && <FillSection deck={deck} el={el} />}
          <ArrangeSection deck={deck} el={el} update={update} />
          <LinkSection el={el} update={update} />
        </>
      ) : (
        slide && (
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
            <p className="faint hint">Drag on the slide to select several objects. Double-click text to edit it.</p>
          </Section>
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
        <IconButton label="Bold (⌘B)" active={!!style.bold} onMouseDown={(e) => e.preventDefault()} onClick={() => set({ bold: !style.bold })}>
          <Bold size={15} />
        </IconButton>
        <IconButton label="Italic (⌘I)" active={!!style.italic} onMouseDown={(e) => e.preventDefault()} onClick={() => set({ italic: !style.italic })}>
          <Italic size={15} />
        </IconButton>
        <IconButton label="Underline (⌘U)" active={!!style.underline} onMouseDown={(e) => e.preventDefault()} onClick={() => set({ underline: !style.underline })}>
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

function ArrangeSection({ deck, el, update }: { deck: Deck; el: Element; update: (patch: Partial<Element>) => void }) {
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
      <div className="toggle-row">
        <IconButton label="Bring to front" onClick={() => tb.onMoveLayerToEdge('front')}>
          <BringToFront size={15} />
        </IconButton>
        <IconButton label="Send to back" onClick={() => tb.onMoveLayerToEdge('back')}>
          <SendToBack size={15} />
        </IconButton>
        <IconButton label="Duplicate (⌘D)" onClick={tb.onDuplicate}>
          <Copy size={15} />
        </IconButton>
        <IconButton label="Delete (⌫)" onClick={tb.onDelete}>
          <Trash2 size={15} />
        </IconButton>
      </div>
    </Section>
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

function MultiSelection({ deck, count }: { deck: Deck; count: number }) {
  const { tb } = deck
  return (
    <Section title={`${count} objects`}>
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
        <button type="button" className="btn" disabled={!tb.selectionGroupable} onClick={tb.onGroupElements}>
          <Group size={14} /> Group
        </button>
        <button type="button" className="btn danger" onClick={tb.onDelete}>
          <Trash2 size={14} /> Delete
        </button>
      </div>
    </Section>
  )
}

function Swatches({ value, onPick }: { value: string | null; onPick: (hex: string) => void }) {
  return (
    <div className="swatches">
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

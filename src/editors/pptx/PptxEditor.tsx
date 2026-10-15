import type { PresentationStore } from '@diceui/pptx'
import { Presentation, useCreatePresentationStore, useHistory, usePresentation, useSlide, useZoom } from '@diceui/pptx'
import type { SlideNode } from '@diceui/pptx-core'
import { renderSlide, searchPresentation } from '@diceui/pptx-core'
import {
  ArrowDown,
  ArrowUp,
  ChevronLeft,
  ChevronRight,
  Copy,
  Minus,
  Play,
  Plus,
  Redo2,
  Trash2,
  Undo2,
} from 'lucide-react'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { EditorProps } from '../../App'
import { FindBar, InspectorHeader, Workbench, formatZoom } from '../../components/Workbench'
import type { MenuEntry } from '../../components/ui'
import { CenterState, ColorField, IconButton, NumberField, PopoverMenu, Section } from '../../components/ui'
import * as platform from '../../lib/platform'
import { registerEditor, useWorkspace } from '../../state/workspace'
import { blankPresentation } from './blank'
import './pptx.css'

export default function PptxEditor({ tab, active }: EditorProps) {
  const store = useCreatePresentationStore()
  const [loadError, setLoadError] = useState<string | null>(null)
  const markDirty = useWorkspace((s) => s.markDirty)

  useEffect(() => {
    let cancelled = false
    void (async () => {
      try {
        const bytes = tab.bytes ?? (await blankPresentation())
        if (!cancelled) await store.load(bytes, { readOnly: false })
      } catch (err) {
        if (err instanceof DOMException && err.name === 'AbortError') return
        if (!cancelled) setLoadError(err instanceof Error ? err.message : String(err))
      }
    })()
    return () => {
      cancelled = true
    }
  }, [store, tab.bytes])

  useEffect(() => store.on('historyChange', ({ isDirty }) => markDirty(tab.id, isDirty)), [store, markDirty, tab.id])

  if (loadError) {
    return (
      <CenterState title="Couldn’t open this presentation">
        <p className="muted">{loadError}</p>
      </CenterState>
    )
  }

  return (
    <Presentation.Provider store={store}>
      <DeckWorkbench tab={tab} active={active} store={store} />
    </Presentation.Provider>
  )
}

function DeckWorkbench({ tab, active, store }: EditorProps & { store: PresentationStore }) {
  const { status, presentation, revision } = usePresentation()
  const slide = useSlide()
  const zoom = useZoom()
  const history = useHistory()
  const [selection, setSelection] = useState<SlideNode[]>([])
  const [presenting, setPresenting] = useState(false)
  const [menu, setMenu] = useState<{ x: number; y: number; slideId: string } | null>(null)
  const [findOpen, setFindOpen] = useState(false)
  const [results, setResults] = useState<{ slideIndex: number }[]>([])
  const [resultIndex, setResultIndex] = useState(0)

  const edit = useCallback(
    async (op: Parameters<PresentationStore['edit']>[0]) => {
      try {
        return await store.edit(op)
      } catch (err) {
        await platform.showError(err instanceof Error ? err.message : String(err))
      }
    },
    [store],
  )

  useEffect(
    () =>
      registerEditor(tab.id, {
        getBytes: () => store.save(),
        find: () => setFindOpen(true),
        zoom: (dir) => {
          if (dir === 'in') store.zoomIn(0.1)
          else if (dir === 'out') store.zoomOut(0.1)
          else store.setAutoFit(true)
        },
        print: () => printSlides(store),
      }),
    [tab.id, store],
  )

  const runFind = (query: string) => {
    const pres = store.getState().presentation
    if (!pres || !query) {
      setResults([])
      return
    }
    const found = searchPresentation(pres, query, { caseSensitive: false } as never)
    setResults(found)
    setResultIndex(0)
    if (found[0]) store.goToIndex(found[0].slideIndex)
  }
  const stepFind = (delta: number) => {
    if (!results.length) return
    const next = (resultIndex + delta + results.length) % results.length
    setResultIndex(next)
    store.goToIndex(results[next].slideIndex)
  }

  const slideMenu = (slideId: string): MenuEntry[] => {
    const index = store.getSlideIndex(slideId)
    const total = presentation?.slides.length ?? 0
    return [
      { label: 'Duplicate Slide', icon: <Copy size={14} />, onSelect: () => void edit({ type: 'duplicateSlide', slideId }) },
      ...(index > 0 ? [{ label: 'Move Up', icon: <ArrowUp size={14} />, onSelect: () => void edit({ type: 'moveSlide', slideId, toIndex: index - 1 }) }] : []),
      ...(index < total - 1 ? [{ label: 'Move Down', icon: <ArrowDown size={14} />, onSelect: () => void edit({ type: 'moveSlide', slideId, toIndex: index + 1 }) }] : []),
      ...(total > 1
        ? [{ label: 'Delete Slide', icon: <Trash2 size={14} />, danger: true, separatorBefore: true, onSelect: () => void edit({ type: 'deleteSlide', slideId }) }]
        : []),
    ]
  }

  if (status === 'error') {
    return (
      <CenterState title="Couldn’t open this presentation">
        <p className="muted">{store.getState().error?.message}</p>
      </CenterState>
    )
  }

  const left = <SlideList store={store} onMenu={(slideId, x, y) => setMenu({ slideId, x, y })} active={active} />
  const total = presentation?.slides.length ?? 0

  const right = (
    <>
      <InspectorHeader kind="pptx">Presentation</InspectorHeader>
      {selection.length > 0 && slide.slideId ? (
        <ShapeInspector key={`${selection[0].id}:${revision}`} node={selection[0]} count={selection.length} slideId={slide.slideId} edit={edit} />
      ) : (
        <Section title={slide.slideId ? `Slide ${slide.index + 1} of ${total}` : 'Slide'}>
          <div className="grid-2">
            <button type="button" className="btn" disabled={!slide.slideId} onClick={() => slide.slideId && void edit({ type: 'duplicateSlide', slideId: slide.slideId })}>
              <Copy size={14} /> Duplicate
            </button>
            <button
              type="button"
              className="btn danger"
              disabled={!slide.slideId || total <= 1}
              onClick={() => slide.slideId && void edit({ type: 'deleteSlide', slideId: slide.slideId })}
            >
              <Trash2 size={14} /> Delete
            </button>
            <button
              type="button"
              className="btn"
              disabled={!slide.slideId || slide.isFirst}
              onClick={() => slide.slideId && void edit({ type: 'moveSlide', slideId: slide.slideId, toIndex: slide.index - 1 })}
            >
              <ArrowUp size={14} /> Move up
            </button>
            <button
              type="button"
              className="btn"
              disabled={!slide.slideId || slide.isLast}
              onClick={() => slide.slideId && void edit({ type: 'moveSlide', slideId: slide.slideId, toIndex: slide.index + 1 })}
            >
              <ArrowDown size={14} /> Move down
            </button>
          </div>
          <p className="faint hint">Click a shape to move, resize or recolor it. Double-click text to edit it.</p>
        </Section>
      )}
      <Section title="Present">
        <button type="button" className="btn primary block" disabled={!total} onClick={() => setPresenting(true)}>
          <Play size={14} /> Play from this slide
        </button>
        <button
          type="button"
          className="btn block"
          disabled={!total}
          onClick={() => {
            store.goToIndex(0)
            setPresenting(true)
          }}
        >
          Play from start
        </button>
      </Section>
      {presentation && (
        <Section title="Deck" collapsible defaultOpen={false}>
          <dl className="stats">
            <dt>Slides</dt>
            <dd>{total}</dd>
            <dt>Size</dt>
            <dd>
              {Math.round(presentation.width)} × {Math.round(presentation.height)}
            </dd>
            <dt>Aspect</dt>
            <dd>{aspectName(presentation.width, presentation.height)}</dd>
          </dl>
        </Section>
      )}
    </>
  )

  return (
    <Workbench tab={tab} left={left} leftFooter={total ? <span>{total === 1 ? '1 slide' : `${total} slides`}</span> : undefined} right={right}>
      <Presentation.Root className="deck-root">
        <Presentation.Viewport className="deck-viewport" autoFit autoFitPadding={{ top: 48, right: 48, bottom: 88, left: 48 }} scrollZoom>
          <Presentation.Slide className="deck-slide">
            <Presentation.Selection undoRedoShortcuts onSelectionChange={({ nodes }) => setSelection(nodes)} />
          </Presentation.Slide>
        </Presentation.Viewport>
        <Presentation.Loading className="deck-loading">{() => <CenterState spinner />}</Presentation.Loading>
      </Presentation.Root>
      <FindBar
        open={findOpen}
        onClose={() => setFindOpen(false)}
        onQuery={runFind}
        onNext={() => stepFind(1)}
        onPrev={() => stepFind(-1)}
        count={results.length}
        current={resultIndex}
        placeholder="Find in slides"
      />
      {total > 0 && (
        <div className="canvas-bar">
          <IconButton label="Undo (⌘Z)" size="sm" disabled={!history.canUndo} onClick={() => history.undo()}>
            <Undo2 size={14} />
          </IconButton>
          <IconButton label="Redo (⇧⌘Z)" size="sm" disabled={!history.canRedo} onClick={() => void history.redo()}>
            <Redo2 size={14} />
          </IconButton>
          <span className="sep" />
          <IconButton label="Previous slide" size="sm" disabled={slide.isFirst} onClick={slide.prev}>
            <ChevronLeft size={14} />
          </IconButton>
          <span className="readout">
            {slide.index + 1} / {total}
          </span>
          <IconButton label="Next slide" size="sm" disabled={slide.isLast} onClick={slide.next}>
            <ChevronRight size={14} />
          </IconButton>
          <span className="sep" />
          <IconButton label="Zoom out (⌘−)" size="sm" onClick={() => zoom.zoomOut(0.1)}>
            <Minus size={14} />
          </IconButton>
          <button type="button" className="icon-btn sm readout" title="Fit to window (⌘0)" onClick={() => zoom.setAutoFit(true)}>
            {zoom.isAutoFit ? 'Fit' : formatZoom(zoom.zoom)}
          </button>
          <IconButton label="Zoom in (⌘+)" size="sm" onClick={() => zoom.zoomIn(0.1)}>
            <Plus size={14} />
          </IconButton>
          <span className="sep" />
          <IconButton label="Present" size="sm" onClick={() => setPresenting(true)}>
            <Play size={14} />
          </IconButton>
        </div>
      )}
      {menu && <PopoverMenu anchor={menu} items={slideMenu(menu.slideId)} onClose={() => setMenu(null)} />}
      {presenting && <PresentMode store={store} onExit={() => setPresenting(false)} />}
    </Workbench>
  )
}

/** Left sidebar: thumbnails with drag-to-reorder and a context menu. */
function SlideList({ store, onMenu, active }: { store: PresentationStore; onMenu: (slideId: string, x: number, y: number) => void; active: boolean }) {
  const listRef = useRef<HTMLDivElement>(null)
  const [drag, setDrag] = useState<{ slideId: string; target: number } | null>(null)

  const startDrag = (e: React.PointerEvent, slideId: string) => {
    if (e.button !== 0) return
    const startY = e.clientY
    const el = e.currentTarget as HTMLElement
    let dragging = false
    let target = -1
    const move = (ev: PointerEvent) => {
      if (!dragging && Math.abs(ev.clientY - startY) < 6) return
      if (!dragging) el.setPointerCapture(e.pointerId)
      dragging = true
      const items = Array.from(listRef.current!.querySelectorAll<HTMLElement>('.slide-item'))
      target = items.length
      for (let i = 0; i < items.length; i++) {
        const r = items[i].getBoundingClientRect()
        if (ev.clientY < r.top + r.height / 2) {
          target = i
          break
        }
      }
      setDrag({ slideId, target })
      const lr = listRef.current!.getBoundingClientRect()
      const scroller = listRef.current!.closest('.sidebar-scroll')
      if (scroller && ev.clientY < lr.top + 30) scroller.scrollTop -= 12
      else if (scroller && ev.clientY > scroller.getBoundingClientRect().bottom - 30) scroller.scrollTop += 12
    }
    const up = () => {
      el.removeEventListener('pointermove', move)
      el.removeEventListener('pointerup', up)
      el.removeEventListener('pointercancel', up)
      setDrag(null)
      if (!dragging) return
      const from = store.getSlideIndex(slideId)
      const to = target > from ? target - 1 : target
      if (to !== from && to >= 0) void store.edit({ type: 'moveSlide', slideId, toIndex: to })
    }
    el.addEventListener('pointermove', move)
    el.addEventListener('pointerup', up)
    el.addEventListener('pointercancel', up)
  }

  useEffect(() => {
    if (!active) return
    return store.on('slideChange', ({ slideId }) => {
      listRef.current?.querySelector(`[data-slide-id="${CSS.escape(slideId ?? '')}"]`)?.scrollIntoView({ block: 'nearest' })
    })
  }, [store, active])

  return (
    <Presentation.ThumbnailList className="slide-list" ref={listRef}>
      {({ slides }) =>
        slides.map((s, i) => (
          <div
            key={s.id}
            className={`slide-item ${drag?.target === i ? 'drop-before' : ''} ${drag && drag.target === slides.length && i === slides.length - 1 ? 'drop-after' : ''} ${
              drag?.slideId === s.id ? 'dragging' : ''
            }`}
            data-slide-id={s.id}
            onPointerDown={(e) => startDrag(e, s.id)}
            onContextMenu={(e) => {
              e.preventDefault()
              store.goTo(s.id)
              onMenu(s.id, e.clientX, e.clientY)
            }}
          >
            <span className="slide-number">{i + 1}</span>
            <Presentation.ThumbnailItem slideId={s.id} className="slide-thumb">
              <Presentation.ThumbnailItemPreview className="slide-thumb-preview" />
            </Presentation.ThumbnailItem>
          </div>
        ))
      }
    </Presentation.ThumbnailList>
  )
}

/** Inspector for the selected shape: geometry, fill, delete. */
function ShapeInspector({
  node,
  count,
  slideId,
  edit,
}: {
  node: SlideNode
  count: number
  slideId: string
  edit: (op: Parameters<PresentationStore['edit']>[0]) => Promise<unknown>
}) {
  const transform = (patch: { position?: { x: number; y: number }; size?: { w: number; h: number }; rotation?: number }) =>
    void edit({ type: 'setNodeTransform', slideId, nodeId: node.id, ...patch })
  const fill = useMemo(() => readSolidFill(node), [node])
  const kind = { shape: node.nodeType === 'shape' && (node as { isTextBox?: boolean }).isTextBox ? 'Text box' : 'Shape', picture: 'Picture', table: 'Table', group: 'Group', chart: 'Chart', unknown: 'Object' }[
    node.nodeType
  ]

  return (
    <>
      <Section title={count > 1 ? `${count} objects` : kind}>
        {count === 1 && node.name && <span className="faint node-name">{node.name}</span>}
        <div className="grid-2">
          <NumberField label="X" value={node.position.x} onCommit={(x) => transform({ position: { x, y: node.position.y } })} />
          <NumberField label="Y" value={node.position.y} onCommit={(y) => transform({ position: { x: node.position.x, y } })} />
          <NumberField label="W" value={node.size.w} min={1} onCommit={(w) => transform({ size: { w, h: node.size.h } })} />
          <NumberField label="H" value={node.size.h} min={1} onCommit={(h) => transform({ size: { w: node.size.w, h } })} />
          <NumberField label="∠" value={node.rotation} suffix="°" onCommit={(rotation) => transform({ rotation: ((rotation % 360) + 360) % 360 })} />
        </div>
      </Section>
      {node.nodeType === 'shape' && (
        <Section title="Fill">
          <ColorField value={fill} label="No fill" onChange={(hex) => void edit({ type: 'setSolidFill', slideId, nodeId: node.id, color: hex })} />
          <div className="swatches">
            {['FFFFFF', '111827', '4F8CFF', 'FF8A3D', 'F2555A', '3ECF8E', 'A98BFF', 'F5A524'].map((c) => (
              <button
                key={c}
                type="button"
                aria-label={`Fill #${c}`}
                className={`swatch ${fill === c ? 'on' : ''}`}
                style={{ background: `#${c}` }}
                onClick={() => void edit({ type: 'setSolidFill', slideId, nodeId: node.id, color: c })}
              />
            ))}
          </div>
        </Section>
      )}
      <Section title="Arrange">
        <button type="button" className="btn danger block" onClick={() => void edit({ type: 'deleteNode', slideId, nodeId: node.id })}>
          <Trash2 size={14} /> Delete {count > 1 ? 'first object' : kind.toLowerCase()}
        </button>
        <p className="faint hint">Drag to move, drag handles to resize, arrow keys to nudge. Double-click text to edit.</p>
      </Section>
    </>
  )
}

/** Full-screen slideshow. Renders slides itself so its scale is independent of the editor's zoom. */
function PresentMode({ store, onExit }: { store: PresentationStore; onExit: () => void }) {
  const pres = store.getState().presentation!
  const slides = useMemo(() => pres.slides.filter((s) => !s.hidden), [pres])
  const [index, setIndex] = useState(() => {
    const active = store.getActiveSlide()
    return Math.max(0, slides.findIndex((s) => s.id === active?.id))
  })
  const stageRef = useRef<HTMLDivElement>(null)
  const exit = useRef(onExit)
  exit.current = onExit
  const indexRef = useRef(index)
  indexRef.current = index

  const go = useCallback((delta: number) => setIndex((i) => Math.min(slides.length - 1, Math.max(0, i + delta))), [slides.length])
  const finish = useCallback(() => {
    // Leave the editor on the slide the presentation ended on.
    const slide = slides[indexRef.current]
    if (slide) store.goTo(slide.id)
    exit.current()
  }, [slides, store])

  useEffect(() => {
    void platform.setFullscreen(true)
    const onKey = (e: KeyboardEvent) => {
      if (['ArrowRight', 'ArrowDown', ' ', 'PageDown', 'Enter', 'n'].includes(e.key)) go(1)
      else if (['ArrowLeft', 'ArrowUp', 'PageUp', 'Backspace', 'p'].includes(e.key)) go(-1)
      else if (e.key === 'Home') setIndex(0)
      else if (e.key === 'End') setIndex(slides.length - 1)
      else if (e.key === 'Escape') finish()
      else return
      e.preventDefault()
      e.stopPropagation()
    }
    window.addEventListener('keydown', onKey, true)
    return () => {
      window.removeEventListener('keydown', onKey, true)
      void platform.setFullscreen(false)
    }
  }, [go, finish, slides.length])

  // Render the current slide and scale it to fill the screen.
  useEffect(() => {
    const stage = stageRef.current
    const slide = slides[index]
    if (!stage || !slide) return
    const handle = renderSlide(pres, slide)
    const el = handle.element
    el.style.position = 'absolute'
    el.style.transformOrigin = '0 0'
    stage.replaceChildren(el)
    const fit = () => {
      const scale = Math.min(stage.clientWidth / pres.width, stage.clientHeight / pres.height)
      el.style.left = `${(stage.clientWidth - pres.width * scale) / 2}px`
      el.style.top = `${(stage.clientHeight - pres.height * scale) / 2}px`
      el.style.transform = `scale(${scale})`
    }
    fit()
    const observer = new ResizeObserver(fit)
    observer.observe(stage)
    return () => {
      observer.disconnect()
      handle.dispose()
    }
  }, [pres, slides, index])

  return (
    <div className="present" onClick={() => (index >= slides.length - 1 ? finish() : go(1))}>
      <div className="present-stage" ref={stageRef} />
      <div className="present-hud">
        {index + 1} / {slides.length} · esc to exit
      </div>
    </div>
  )
}

function readSolidFill(node: SlideNode): string | null {
  const fill = (node as { fill?: { element?: Element | null } }).fill?.element
  if (!fill) return null
  const srgb = fill.localName === 'solidFill' ? fill.getElementsByTagNameNS('*', 'srgbClr')[0] : null
  return srgb?.getAttribute('val')?.toUpperCase() ?? null
}

function aspectName(w: number, h: number) {
  const r = w / h
  if (Math.abs(r - 16 / 9) < 0.02) return '16:9'
  if (Math.abs(r - 4 / 3) < 0.02) return '4:3'
  if (Math.abs(r - 16 / 10) < 0.02) return '16:10'
  return r.toFixed(2)
}

/** Render every slide into the print root and open the print panel (landscape). */
async function printSlides(store: PresentationStore) {
  const pres = store.getState().presentation
  if (!pres) return
  const root = document.getElementById('print-root')!
  root.innerHTML = ''
  const style = document.createElement('style')
  style.textContent = `@page { size: landscape; margin: 0.4in; }`
  root.appendChild(style)
  // Landscape Letter/A4 minus margins is roughly 10 × 7 inches at 96 px/in.
  const scale = Math.min((10 * 96) / pres.width, (7 * 96) / pres.height)
  const handles = []
  for (const s of pres.slides) {
    if (s.hidden) continue
    const handle = renderSlide(pres, s)
    handles.push(handle)
    const page = document.createElement('div')
    page.className = 'print-page pptx-print-page'
    const frame = document.createElement('div')
    frame.className = 'pptx-print-frame'
    frame.style.width = `${pres.width * scale}px`
    frame.style.height = `${pres.height * scale}px`
    handle.element.style.transformOrigin = '0 0'
    handle.element.style.transform = `scale(${scale})`
    frame.appendChild(handle.element)
    page.appendChild(frame)
    root.appendChild(page)
  }
  await Promise.all(handles.map((h) => h.ready.catch(() => {})))
  window.print()
}

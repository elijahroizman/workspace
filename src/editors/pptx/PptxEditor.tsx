import './setup'
import { ArrowDown, ArrowUp, ChevronLeft, ChevronRight, Copy, EyeOff, Minus, Play, Plus, Redo2, Trash2, Undo2 } from 'lucide-react'
import i18n from 'i18next'
import type { PowerPointViewerHandle, SlideTemplateId } from 'pptx-react-viewer'
import { SlideCanvas, useViewerBuildingBlocks } from 'pptx-react-viewer'
import { useCallback, useEffect, useRef, useState } from 'react'
import { createRoot } from 'react-dom/client'
import type { EditorProps } from '../../App'
import { FindBar, Workbench, formatZoom } from '../../components/Workbench'
import type { MenuEntry } from '../../components/ui'
import { CenterState, IconButton, PopoverMenu } from '../../components/ui'
import { usePinchZoom } from '../../lib/pinch'
import * as platform from '../../lib/platform'
import { registerEditor, useWorkspace } from '../../state/workspace'
import { blankPresentation } from './blank'
import { Inspector } from './Inspector'
import { PresentMode } from './PresentMode'
import { SlidePreview, SlideStrip } from './SlideStrip'
import type { Deck, Element, Slide, Toolbar } from './types'
import { parseVideoLink, videoPoster } from './video'
import './pptx.css'

/** Starter slides offered by New Slide; each comes with placeholder text in the deck's theme colors. */
const NEW_SLIDE_TEMPLATES: SlideTemplateId[] = ['titleAndContent', 'title', 'sectionHeader', 'twoContent', 'comparison', 'titleOnly', 'quote', 'closing', 'blank']

export default function PptxEditor({ tab, active }: EditorProps) {
  const [content, setContent] = useState<Uint8Array | null>(tab.bytes)
  useEffect(() => {
    if (!tab.bytes) void blankPresentation().then(setContent)
  }, [tab.bytes])
  if (!content) return <CenterState spinner />
  return <DeckEditor tab={tab} active={active} content={content} />
}

function DeckEditor({ tab, active, content }: EditorProps & { content: Uint8Array }) {
  const handle = useRef<PowerPointViewerHandle>(null)
  const { toolbarProps: tb, canvasProps: cv, loading, error } = useViewerBuildingBlocks({
    content,
    // The engine listens for shortcuts on the whole window; a deck in a background tab must
    // not react to ⌘Z or Delete pressed elsewhere, so it drops to view mode while hidden.
    canEdit: active,
    handle,
    fileName: tab.title,
    autosaveEnabled: false,
    fitPadding: 40,
    maxFitScale: null,
  })
  const tbRef = useRef<Toolbar>(tb)
  tbRef.current = tb
  const cvRef = useRef(cv)
  cvRef.current = cv
  // The engine keeps the deck internally and exposes it through the handle, which updates
  // after each commit; read it in an effect so the sidebar follows every edit.
  const [slides, setSlides] = useState<readonly Slide[]>([])
  useEffect(() => {
    const next = handle.current?.getSlides()
    if (next && next !== slides) setSlides(next)
  })
  const activeIndex = Math.max(0, cv.activeSlide ? slides.findIndex((s) => s.id === cv.activeSlide!.id) : 0)
  const markDirty = useWorkspace((s) => s.markDirty)
  const [menu, setMenu] = useState<{ x: number; y: number; items: MenuEntry[] } | null>(null)
  const [presenting, setPresenting] = useState<number | null>(null)
  const [findOpen, setFindOpen] = useState(false)
  const [matches, setMatches] = useState<{ slide: number; id: string }[]>([])
  const [matchIndex, setMatchIndex] = useState(0)
  const stageRef = useRef<HTMLDivElement>(null)

  // ── Unsaved changes: the slide list is replaced on every edit, never on navigation.
  const savedSlides = useRef<readonly Slide[] | null>(null)
  useEffect(() => {
    if (loading || !slides.length) return
    if (savedSlides.current === null) savedSlides.current = slides
    markDirty(tab.id, slides !== savedSlides.current)
  }, [slides, loading, markDirty, tab.id])

  // ── Layout/master artwork for thumbnails. The engine exposes it for the slide on screen,
  // so remember it per layout as slides are shown, and walk each layout once after loading.
  const templates = useRef(new Map<string, Element[]>())
  const [templateVersion, setTemplateVersion] = useState(0)
  useEffect(() => {
    const s = cv.activeSlide
    if (!s) return
    const key = s.layoutPath ?? ''
    if (templates.current.get(key) !== cv.templateElements) {
      templates.current.set(key, cv.templateElements)
      setTemplateVersion((v) => v + 1)
    }
  }, [cv.activeSlide, cv.templateElements])

  const primed = useRef(false)
  useEffect(() => {
    if (loading || primed.current || !slides.length) return
    primed.current = true
    const firstOfLayout = new Map<string, number>()
    slides.forEach((s, i) => !firstOfLayout.has(s.layoutPath ?? '') && firstOfLayout.set(s.layoutPath ?? '', i))
    const queue = [...firstOfLayout.values()].filter((i) => i !== 0)
    if (!queue.length) return
    void (async () => {
      for (const i of queue) {
        handle.current?.setActiveSlideIndex(i)
        await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)))
      }
      handle.current?.setActiveSlideIndex(0)
    })()
  }, [loading, slides])

  const templateFor = useCallback(
    (s: Slide) => (s.showMasterShapes === false ? [] : (templates.current.get(s.layoutPath ?? '') ?? [])),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [templateVersion],
  )

  const deck: Deck = { handle, tb, cv, slides, activeIndex, templateFor, tbRef }

  // Spellcheck while typing in text boxes.
  useEffect(() => {
    if (!loading && !tb.spellCheckEnabled) tb.onSetSpellCheckEnabled(true)
  }, [loading, tb])

  // Trackpad pinch / ⌘-scroll zoom with a live preview, committed when the gesture ends.
  usePinchZoom(stageRef, {
    getZoom: () => tbRef.current.scale,
    setZoom: (z) => handle.current?.setZoom(Math.min(4, Math.max(0.1, z))),
    target: () => cvRef.current.zoom.canvasStageRef.current,
  })

  // ── Inserting things
  const insertImage = async () => {
    const files = await pickImageFiles()
    for (const file of files) {
      const dataUrl = await readAsDataUrl(file)
      const { width, height } = await imageSize(dataUrl)
      const size = fitInside(width, height, cv.canvasSize.width * 0.6, cv.canvasSize.height * 0.6)
      handle.current?.addElement({
        id: crypto.randomUUID(),
        type: 'image',
        imageData: dataUrl,
        x: Math.round((cv.canvasSize.width - size.width) / 2),
        y: Math.round((cv.canvasSize.height - size.height) / 2),
        ...size,
      } as unknown as Element)
    }
  }

  const insertVideo = async (raw: string) => {
    const link = parseVideoLink(raw)
    if (!link) {
      await platform.showError('That doesn’t look like a video link. Paste a YouTube or Vimeo address.')
      return false
    }
    const poster = await videoPoster(link)
    const width = Math.round(cv.canvasSize.width * 0.6)
    const height = Math.round((width * 9) / 16)
    handle.current?.addElement({
      id: crypto.randomUUID(),
      type: 'image',
      name: `Video: ${link.url}`,
      imageData: poster,
      x: Math.round((cv.canvasSize.width - width) / 2),
      y: Math.round((cv.canvasSize.height - height) / 2),
      width,
      height,
      actionClick: { action: '', url: link.url, tooltip: 'Play video' },
    } as unknown as Element)
    return true
  }

  const newSlideMenu = (anchor: { x: number; y: number }) => {
    const insertTemplate = tb.onInsertSlideFromTemplate
    const items: MenuEntry[] = insertTemplate
      ? NEW_SLIDE_TEMPLATES.map((id) => ({ label: i18n.t(`pptx.slideTemplates.${id}.name`), onSelect: () => insertTemplate(id) }))
      : [{ label: 'Blank Slide', onSelect: () => handle.current?.addSlide(activeIndex) }]
    // A deck made in PowerPoint brings its own layouts; one generated by a script has a single unnamed one.
    if (tb.layoutOptions.length > 1) {
      tb.layoutOptions.forEach((l, i) =>
        items.push({ label: l.name, separatorBefore: i === 0, onSelect: () => tb.onInsertSlideFromLayout(l.path, l.name) }),
      )
    }
    setMenu({ ...anchor, items })
  }

  const slideMenu = (index: number, x: number, y: number) => {
    const h = handle.current
    setMenu({
      x,
      y,
      items: [
        {
          label: 'New Slide After',
          icon: <Plus size={14} />,
          onSelect: () => {
            // New slides go after the current one.
            h?.setActiveSlideIndex(index)
            newSlideMenu({ x, y })
          },
        },
        { label: 'Duplicate Slide', icon: <Copy size={14} />, onSelect: () => h?.duplicateSlides([index]) },
        { label: slides[index]?.hidden ? 'Show in Slideshow' : 'Hide in Slideshow', icon: <EyeOff size={14} />, onSelect: () => h?.toggleHideSlides([index]) },
        ...(index > 0 ? [{ label: 'Move Up', icon: <ArrowUp size={14} />, onSelect: () => h?.moveSlide(index, index - 1) }] : []),
        ...(index < slides.length - 1 ? [{ label: 'Move Down', icon: <ArrowDown size={14} />, onSelect: () => h?.moveSlide(index, index + 1) }] : []),
        ...(slides.length > 1 ? [{ label: 'Delete Slide', icon: <Trash2 size={14} />, danger: true, separatorBefore: true, onSelect: () => h?.deleteSlides([index]) }] : []),
      ],
    })
  }

  // ── Find across every slide's text.
  const runFind = (query: string) => {
    const q = query.trim().toLowerCase()
    const found: { slide: number; id: string }[] = []
    if (q) {
      slides.forEach((s, si) =>
        s.elements.forEach((e) => {
          const text = elementText(e)
          if (text.toLowerCase().includes(q)) found.push({ slide: si, id: e.id })
        }),
      )
    }
    setMatches(found)
    setMatchIndex(0)
    if (found[0]) goToMatch(found[0])
  }
  const goToMatch = (m: { slide: number; id: string }) => {
    handle.current?.setActiveSlideIndex(m.slide)
    requestAnimationFrame(() => handle.current?.selectElements([m.id]))
  }
  const stepFind = (delta: number) => {
    if (!matches.length) return
    const next = (matchIndex + delta + matches.length) % matches.length
    setMatchIndex(next)
    goToMatch(matches[next])
  }

  // ── Shell integration
  const slidesRef = useRef(slides)
  slidesRef.current = slides
  const templateForRef = useRef(templateFor)
  templateForRef.current = templateFor
  useEffect(
    () =>
      registerEditor(tab.id, {
        getBytes: async () => {
          const bytes = await handle.current?.getContent()
          if (!bytes) throw new Error('The presentation is still loading.')
          return bytes
        },
        markSaved: () => {
          savedSlides.current = slidesRef.current
          markDirty(tab.id, false)
        },
        find: () => setFindOpen(true),
        zoom: (dir) => {
          if (dir === 'in') tbRef.current.onZoomIn()
          else if (dir === 'out') tbRef.current.onZoomOut()
          else tbRef.current.onZoomToFit()
        },
        print: () => printSlides(slidesRef.current, cvRef.current.canvasSize, templateForRef.current),
      }),
    [tab.id, markDirty],
  )
  if (error) {
    return (
      <CenterState title="Couldn’t open this presentation">
        <p className="muted">{error}</p>
      </CenterState>
    )
  }

  const left = loading ? null : (
    <SlideStrip
      slides={slides}
      activeIndex={activeIndex}
      canvasSize={cv.canvasSize}
      templateFor={templateFor}
      onSelect={(i) => handle.current?.setActiveSlideIndex(i)}
      onMove={(from, to) => handle.current?.moveSlide(from, to)}
      onMenu={slideMenu}
    />
  )

  return (
    <Workbench
      tab={tab}
      left={left ?? <div />}
      leftFooter={slides.length ? <span>{slides.length === 1 ? '1 slide' : `${slides.length} slides`}</span> : undefined}
      right={
        loading ? (
          <div />
        ) : (
          <Inspector
            deck={deck}
            onInsertImage={() => void insertImage()}
            onInsertVideo={insertVideo}
            onNewSlide={newSlideMenu}
            onPresent={(fromStart) => setPresenting(fromStart ? 0 : activeIndex)}
          />
        )
      }
    >
      <div className="deck-stage" ref={stageRef}>
        {loading ? <CenterState spinner /> : <SlideCanvas {...cv} showRulers={false} />}
      </div>
      <FindBar
        open={findOpen}
        onClose={() => setFindOpen(false)}
        onQuery={runFind}
        onNext={() => stepFind(1)}
        onPrev={() => stepFind(-1)}
        count={matches.length}
        current={matchIndex}
        placeholder="Find in slides"
      />
      {!loading && slides.length > 0 && (
        <div className="canvas-bar">
          <IconButton label="Undo (⌘Z)" size="sm" disabled={!tb.canUndo} onClick={tb.onUndo}>
            <Undo2 size={14} />
          </IconButton>
          <IconButton label="Redo (⇧⌘Z)" size="sm" disabled={!tb.canRedo} onClick={tb.onRedo}>
            <Redo2 size={14} />
          </IconButton>
          <span className="sep" />
          <IconButton label="Previous slide" size="sm" disabled={activeIndex === 0} onClick={() => handle.current?.setActiveSlideIndex(activeIndex - 1)}>
            <ChevronLeft size={14} />
          </IconButton>
          <span className="readout">
            {activeIndex + 1} / {slides.length}
          </span>
          <IconButton label="Next slide" size="sm" disabled={activeIndex >= slides.length - 1} onClick={() => handle.current?.setActiveSlideIndex(activeIndex + 1)}>
            <ChevronRight size={14} />
          </IconButton>
          <span className="sep" />
          <IconButton label="Zoom out (⌘−)" size="sm" onClick={tb.onZoomOut}>
            <Minus size={14} />
          </IconButton>
          <button type="button" className="icon-btn sm readout" title={platform.shortcut('Fit to window (⌘0)')} onClick={tb.onZoomToFit}>
            {formatZoom(tb.scale)}
          </button>
          <IconButton label="Zoom in (⌘+)" size="sm" onClick={tb.onZoomIn}>
            <Plus size={14} />
          </IconButton>
          <span className="sep" />
          <IconButton label="Present" size="sm" onClick={() => setPresenting(activeIndex)}>
            <Play size={14} />
          </IconButton>
        </div>
      )}
      {menu && <PopoverMenu anchor={menu} items={menu.items} onClose={() => setMenu(null)} />}
      {presenting !== null && (
        <PresentMode
          slides={slides}
          startIndex={presenting}
          canvasSize={cv.canvasSize}
          templateFor={templateFor}
          onExit={(last) => {
            setPresenting(null)
            handle.current?.setActiveSlideIndex(last)
          }}
        />
      )}
    </Workbench>
  )
}

function elementText(e: Element): string {
  const anyEl = e as { text?: string; textSegments?: { text?: string }[]; tableData?: { rows?: { cells?: { text?: string }[] }[] } }
  if (anyEl.textSegments?.length) return anyEl.textSegments.map((s) => s.text ?? '').join('')
  if (anyEl.text) return anyEl.text
  if (anyEl.tableData?.rows) return anyEl.tableData.rows.flatMap((r) => r.cells?.map((c) => c.text ?? '') ?? []).join(' ')
  return ''
}

function pickImageFiles(): Promise<File[]> {
  return new Promise((resolve) => {
    const input = document.createElement('input')
    input.type = 'file'
    input.accept = 'image/png,image/jpeg,image/gif,image/webp,image/svg+xml'
    input.multiple = true
    input.onchange = () => resolve(Array.from(input.files ?? []))
    input.oncancel = () => resolve([])
    input.click()
  })
}

function readAsDataUrl(file: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(String(reader.result))
    reader.onerror = () => reject(reader.error)
    reader.readAsDataURL(file)
  })
}

function imageSize(src: string): Promise<{ width: number; height: number }> {
  return new Promise((resolve) => {
    const img = new Image()
    img.onload = () => resolve({ width: img.naturalWidth || 400, height: img.naturalHeight || 300 })
    img.onerror = () => resolve({ width: 400, height: 300 })
    img.src = src
  })
}

function fitInside(w: number, h: number, maxW: number, maxH: number) {
  const scale = Math.min(1, maxW / w, maxH / h)
  return { width: Math.round(w * scale), height: Math.round(h * scale) }
}

/** Render every visible slide into the print root at landscape page size, then print. */
async function printSlides(all: readonly Slide[], canvasSize: Deck['cv']['canvasSize'], templateFor: (s: Slide) => Element[]) {
  const slides = all.filter((s) => !s.hidden)
  const root = document.getElementById('print-root')!
  root.innerHTML = '<style>@page { size: landscape; margin: 0.4in; }</style>'
  const host = document.createElement('div')
  root.appendChild(host)
  const width = 10 * 96 // fits Letter and A4 landscape inside the margins
  const reactRoot = createRoot(host)
  reactRoot.render(
    <>
      {slides.map((s) => (
        <div key={s.id} className="print-page pptx-print-page">
          <SlidePreview slide={s} templateElements={templateFor(s)} canvasSize={canvasSize} width={width} lazy={false} />
        </div>
      ))}
    </>,
  )
  await new Promise((r) => setTimeout(r, 400))
  await Promise.all(Array.from(root.querySelectorAll('img')).map((img) => img.decode().catch(() => {})))
  window.print()
  setTimeout(() => reactRoot.unmount(), 60_000)
}

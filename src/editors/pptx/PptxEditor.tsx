import './setup'
import {
  ArrowDown,
  ArrowUp,
  BringToFront,
  ChevronLeft,
  ChevronRight,
  ClipboardPaste,
  Copy,
  EyeOff,
  Group,
  Minus,
  MoveDown,
  MoveUp,
  Play,
  Plus,
  Redo2,
  Scissors,
  SendToBack,
  StickyNote,
  Trash2,
  Undo2,
  Ungroup,
} from 'lucide-react'
import i18n from 'i18next'
import type { SlideTemplateId } from 'pptx-react-viewer'
import { SlideCanvas, useViewerBuildingBlocks } from 'pptx-react-viewer'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { createRoot } from 'react-dom/client'
import type { EditorProps } from '../../App'
import { FindBar, Workbench, formatZoom } from '../../components/Workbench'
import type { MenuEntry } from '../../components/ui'
import { CenterState, IconButton, PopoverMenu } from '../../components/ui'
import { usePinchZoom } from '../../lib/pinch'
import * as platform from '../../lib/platform'
import { keysFor, withKeys } from '../../state/shortcuts'
import { registerEditor, useWorkspace } from '../../state/workspace'
import type { Restack } from './arrange'
import { canRestack, mapPicked, pickedText, restack, styleText, withElements } from './arrange'
import { blankPresentation } from './blank'
import { Inspector, tableLooks } from './Inspector'
import { NotesPane } from './Notes'
import { PresentMode } from './PresentMode'
import type { PickMode } from './SlideStrip'
import { SlidePreview, SlideStrip } from './SlideStrip'
import { newTable } from './table'
import type { Deck, Element, Handle, Slide, Toolbar } from './types'
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
  const handle = useRef<Handle>(null)
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

  // ── Slides picked in the sidebar, by id so they survive moves. The active slide is always picked.
  const [picked, setPicked] = useState<string[]>([])
  const pickAnchor = useRef(0)
  const selectedSlides = useMemo(() => {
    const ids = new Set(picked)
    const out = slides.flatMap((s, i) => (ids.has(s.id) ? [i] : []))
    return out.includes(activeIndex) ? out : [activeIndex]
  }, [picked, slides, activeIndex])
  const pickSlide = (index: number, mode: PickMode) => {
    const id = slides[index]?.id
    if (!id) return
    if (mode === 'range') {
      const [a, b] = [Math.min(pickAnchor.current, index), Math.max(pickAnchor.current, index)]
      setPicked(slides.slice(a, b + 1).map((s) => s.id))
    } else if (mode === 'toggle' && selectedSlides.includes(index)) {
      if (selectedSlides.length === 1) return
      const rest = selectedSlides.filter((i) => i !== index)
      setPicked(rest.map((i) => slides[i].id))
      pickAnchor.current = rest[0]
      // Put down the active slide, and the nearest picked one takes over.
      if (index === activeIndex) handle.current?.setActiveSlideIndex(rest.reduce((best, i) => (Math.abs(i - index) < Math.abs(best - index) ? i : best)))
      return
    } else {
      setPicked(mode === 'toggle' ? [...selectedSlides.map((i) => slides[i].id), id] : [id])
      pickAnchor.current = index
    }
    handle.current?.setActiveSlideIndex(index)
  }
  const deleteSlides = (indexes: readonly number[]) => {
    // A deck keeps at least one slide.
    if (!indexes.length || indexes.length >= slides.length) return
    handle.current?.deleteSlides([...indexes])
    setPicked([])
  }

  const selectedIds = useMemo(() => [...cv.selectedElementIdSet], [cv.selectedElementIdSet])
  const deck: Deck = { handle, tb, cv, slides, activeIndex, templateFor, tbRef, selectedSlides, selectedIds }
  const deckRef = useRef(deck)
  deckRef.current = deck

  // Spellcheck while typing in text boxes.
  useEffect(() => {
    if (!loading && !tb.spellCheckEnabled) tb.onSetSpellCheckEnabled(true)
  }, [loading, tb])

  // Trackpad pinch / ⌘-scroll zoom with a live preview, committed when the gesture ends. The
  // preview scales the wrapper around the slide: the slide itself carries the engine's own scale.
  usePinchZoom(stageRef, {
    getZoom: () => tbRef.current.scale,
    setZoom: (z) => handle.current?.setZoom(z),
    commit: (z, anchor) => zoomAround(() => handle.current?.setZoom(z), anchor),
    target: () => cvRef.current.zoom.editWrapperRef.current,
    min: 0.25,
    max: 4,
  })

  /**
   * Zoom while keeping one point of the slide where it is on screen: the pointer for a pinch,
   * the middle of the view for buttons and keys. The engine alone leaves the scroll position as
   * it was, which drifts toward the slide's top-left corner.
   */
  const zoomAround = (apply: () => void, at?: { x: number; y: number }) => {
    const viewport = cvRef.current.zoom.canvasViewportRef.current
    const wrapper = cvRef.current.zoom.editWrapperRef.current
    if (!viewport || !wrapper) return apply()
    const view = viewport.getBoundingClientRect()
    const before = wrapper.getBoundingClientRect()
    const point = at ?? { x: view.left + view.width / 2, y: view.top + view.height / 2 }
    const fx = (point.x - before.left) / before.width
    const fy = (point.y - before.top) / before.height
    apply()
    // Wait for the engine to lay the slide out at the new size.
    requestAnimationFrame(() =>
      requestAnimationFrame(() => {
        const after = wrapper.getBoundingClientRect()
        viewport.scrollLeft += after.left + fx * after.width - point.x
        viewport.scrollTop += after.top + fy * after.height - point.y
      }),
    )
  }
  const zoomStep = (dir: 'in' | 'out' | 'fit' | 'reset') => {
    if (dir === 'fit' || dir === 'reset') return tbRef.current.onZoomToFit()
    const scale = tbRef.current.scale
    const next = dir === 'in' ? ZOOM_STEPS.find((z) => z > scale + 0.001) : [...ZOOM_STEPS].reverse().find((z) => z < scale - 0.001)
    if (next) zoomAround(() => handle.current?.setZoom(next))
  }

  // ── Inserting things
  const addImages = async (files: readonly File[]) => {
    const ids: string[] = []
    for (const file of files) {
      const canvasSize = cvRef.current.canvasSize
      const { dataUrl, width, height } = await loadImage(file, canvasSize)
      const size = fitInside(width, height, canvasSize.width * 0.6, canvasSize.height * 0.6)
      const id = handle.current?.addElement({
        id: crypto.randomUUID(),
        type: 'image',
        imageData: dataUrl,
        x: Math.round((canvasSize.width - size.width) / 2),
        y: Math.round((canvasSize.height - size.height) / 2),
        ...size,
      } as unknown as Element)
      if (id) ids.push(id)
    }
    if (ids.length > 1) requestAnimationFrame(() => handle.current?.selectElements(ids))
  }
  const insertImage = async () => addImages(await platform.pickImages({ multiple: true }))

  // Pasting an image: the engine only catches it while its canvas has keyboard focus, and
  // keeps the full-size picture. Take any image paste aimed at the deck, sized for the slide.
  const addImagesRef = useRef(addImages)
  addImagesRef.current = addImages
  useEffect(() => {
    if (!active) return
    const onPaste = (e: ClipboardEvent) => {
      if (isTextTarget(e.target) || document.querySelector('.present')) return
      const files = Array.from(e.clipboardData?.files ?? []).filter((f) => f.type.startsWith('image/'))
      if (!files.length) return
      e.preventDefault()
      e.stopImmediatePropagation()
      void addImagesRef.current(files)
    }
    window.addEventListener('paste', onPaste, true)
    return () => window.removeEventListener('paste', onPaste, true)
  }, [active])

  // ── Arranging objects
  const arrange = (how: Restack) => {
    const { activeIndex: index, selectedIds: ids } = deckRef.current
    if (ids.length) handle.current?.editSlides(withElements(index, (els) => restack(els, new Set(ids), how)))
  }
  const canArrange = (how: Restack) => {
    const elements = slides[activeIndex]?.elements
    return !!elements && selectedIds.length > 0 && canRestack(elements, new Set(selectedIds), how)
  }

  const arrangeRef = useRef(arrange)
  arrangeRef.current = arrange

  const insertTable = (rows: number, cols: number) => {
    const table = newTable(rows, cols, cv.canvasSize, tableLooks(deck)[0], tb.themeFonts?.body)
    const id = handle.current?.addElement({ ...table, id: crypto.randomUUID() } as Element)
    if (id) requestAnimationFrame(() => handle.current?.selectElements([id]))
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
    const group = selectedSlides.includes(index) && selectedSlides.length > 1 ? selectedSlides : null
    if (group) {
      const allHidden = group.every((i) => slides[i]?.hidden)
      setMenu({
        x,
        y,
        items: [
          { label: `Duplicate ${group.length} Slides`, icon: <Copy size={14} />, onSelect: () => h?.duplicateSlides(group) },
          { label: allHidden ? 'Show in Slideshow' : 'Hide in Slideshow', icon: <EyeOff size={14} />, onSelect: () => h?.toggleHideSlides(group.filter((i) => !!slides[i]?.hidden === allHidden)) },
          ...(group.length < slides.length
            ? [{ label: `Delete ${group.length} Slides`, icon: <Trash2 size={14} />, danger: true, separatorBefore: true, onSelect: () => deleteSlides(group) }]
            : []),
        ],
      })
      return
    }
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

  // ── Right-click on the slide: the engine selects what was clicked; the menu is ours.
  const objectMenu = (x: number, y: number) => {
    requestAnimationFrame(() => {
      const t = tbRef.current
      const { selectedIds: ids } = deckRef.current
      const items: MenuEntry[] = []
      if (ids.length) {
        items.push(
          { label: 'Cut', icon: <Scissors size={14} />, shortcut: '⌘X', onSelect: t.onCut },
          { label: 'Copy', icon: <Copy size={14} />, shortcut: '⌘C', onSelect: t.onCopy },
        )
      }
      if (t.clipboardPayload) items.push({ label: 'Paste', icon: <ClipboardPaste size={14} />, shortcut: '⌘V', onSelect: t.onPaste })
      if (!ids.length) {
        if (items.length) setMenu({ x, y, items })
        return
      }
      items.push({ label: 'Duplicate', icon: <Copy size={14} />, shortcut: keysFor('pptx.duplicate'), onSelect: t.onDuplicate })
      if (ids.length > 1) items.push({ label: 'Group', icon: <Group size={14} />, shortcut: keysFor('pptx.group'), separatorBefore: true, disabled: !t.selectionGroupable, onSelect: t.onGroupElements })
      else if (t.selectedElement?.type === 'group') items.push({ label: 'Ungroup', icon: <Ungroup size={14} />, shortcut: keysFor('pptx.ungroup'), separatorBefore: true, onSelect: t.onUngroupElement })
      const elements = deckRef.current.slides[deckRef.current.activeIndex]?.elements ?? []
      const picked = new Set(ids)
      const layer = (label: string, how: Restack, icon: React.ReactNode, first = false): MenuEntry => ({
        label,
        icon,
        shortcut: keysFor(`pptx.${how}`),
        separatorBefore: first,
        disabled: !canRestack(elements, picked, how),
        onSelect: () => arrange(how),
      })
      items.push(
        layer('Bring to Front', 'front', <BringToFront size={14} />, true),
        layer('Bring Forward', 'forward', <MoveUp size={14} />),
        layer('Send Backward', 'backward', <MoveDown size={14} />),
        layer('Send to Back', 'back', <SendToBack size={14} />),
        { label: 'Delete', icon: <Trash2 size={14} />, danger: true, separatorBefore: true, onSelect: t.onDelete },
      )
      setMenu({ x, y, items })
    })
  }
  // Shift-click (or ⌘-click; Ctrl-click on Windows) adds an object to the selection or takes it
  // out. The engine's own press handler first selects the object alone, so its click then
  // undoes the pick; modified clicks are handled here instead.
  const isAdditive = (e: React.MouseEvent) => e.shiftKey || (platform.isMac ? e.metaKey : e.ctrlKey)
  const toggleObject = (pressedId: string) => {
    const elements = deckRef.current.slides[deckRef.current.activeIndex]?.elements ?? []
    // A press inside a group picks the whole group, as a plain click does.
    const id = elements.find((el) => el.id === pressedId || containsId(el, pressedId))?.id ?? pressedId
    const current = deckRef.current.selectedIds
    handle.current?.selectElements(current.includes(id) ? current.filter((x) => x !== id) : [...current, id])
  }
  const canvasProps = {
    ...cv,
    onMouseDown: (id: string, e: React.MouseEvent) => {
      if (e.button === 0 && isAdditive(e) && !cv.inlineEditingElementId) {
        e.stopPropagation()
        toggleObject(id)
        return
      }
      cv.onMouseDown(id, e)
    },
    onClick: (id: string, e: React.MouseEvent) => {
      if (isAdditive(e) && !cv.inlineEditingElementId) {
        e.stopPropagation()
        return
      }
      cv.onClick(id, e)
    },
    onContextMenu: (id: string, e: React.MouseEvent) => {
      cv.onContextMenu(id, e)
      objectMenu(e.clientX, e.clientY)
    },
    onCanvasContextMenu: (e: React.MouseEvent) => {
      cv.onCanvasContextMenu?.(e)
      objectMenu(e.clientX, e.clientY)
    },
  }

  // Shortcut actions (see state/shortcuts.ts); they read the deck through refs.
  const arrangeKey = (how: Restack) => {
    if (isTextTarget(document.activeElement) || !deckRef.current.selectedIds.length) return false
    arrangeRef.current(how)
  }
  const toggleText = (key: 'bold' | 'italic' | 'underline') => {
    const { selectedIds: ids, activeIndex: index, slides: all } = deckRef.current
    const t = tbRef.current
    if (ids.length === 1 && t.selectedElement && 'textStyle' in t.selectedElement) {
      const style = (t.selectedElement as { textStyle?: Record<string, unknown> }).textStyle
      t.onUpdateTextStyle({ [key]: !style?.[key] })
      return
    }
    const picked = new Set(ids)
    const texts = pickedText(all[index]?.elements ?? [], picked)
    if (!texts.length) return false
    const on = !texts.every((el) => !!el.textStyle?.[key])
    handle.current?.editSlides(withElements(index, (els) => mapPicked(els, picked, (el) => styleText(el, { [key]: on }))))
  }

  // ── Speaker notes
  const [notesOpen, setNotesOpen] = useState(true)
  const setNotes = (id: string, notes: string) => handle.current?.editSlides((all) => all.map((s) => (s.id === id ? { ...s, notes, notesSegments: undefined } : s)))

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
        zoom: (dir) => zoomStep(dir),
        actions: {
          'text.bold': () => toggleText('bold'),
          'text.italic': () => toggleText('italic'),
          'text.underline': () => toggleText('underline'),
          'pptx.new-slide': () => handle.current?.addSlide(deckRef.current.activeIndex),
          'pptx.duplicate': () => (deckRef.current.selectedIds.length ? tbRef.current.onDuplicate() : handle.current?.duplicateSlides([...deckRef.current.selectedSlides])),
          'pptx.group': () => deckRef.current.selectedIds.length > 1 && (tbRef.current.onGroupElements(), true),
          'pptx.ungroup': () => tbRef.current.selectedElement?.type === 'group' && (tbRef.current.onUngroupElement(), true),
          'pptx.front': () => arrangeKey('front'),
          'pptx.forward': () => arrangeKey('forward'),
          'pptx.backward': () => arrangeKey('backward'),
          'pptx.back': () => arrangeKey('back'),
          'pptx.notes': () => setNotesOpen((open) => !open),
          'pptx.present': () => setPresenting(deckRef.current.activeIndex),
          'pptx.present-start': () => setPresenting(0),
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
      selected={selectedSlides}
      canvasSize={cv.canvasSize}
      templateFor={templateFor}
      onSelect={pickSlide}
      onMove={(from, to) => handle.current?.moveSlide(from, to)}
      onMenu={slideMenu}
      onDelete={() => deleteSlides(selectedSlides)}
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
            onInsertTable={insertTable}
            onInsertVideo={insertVideo}
            onNewSlide={newSlideMenu}
            onPresent={(fromStart) => setPresenting(fromStart ? 0 : activeIndex)}
            onDeleteSlides={deleteSlides}
            onArrange={arrange}
            canArrange={canArrange}
          />
        )
      }
    >
      <div className="deck-stage" ref={stageRef}>
        {loading ? <CenterState spinner /> : <SlideCanvas {...canvasProps} showRulers={false} />}
      </div>
      {!loading && notesOpen && slides[activeIndex] && <NotesPane key={slides[activeIndex].id} slide={slides[activeIndex]} onChange={(text) => setNotes(slides[activeIndex].id, text)} />}
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
        <div className="canvas-bar" style={notesOpen ? { bottom: 'calc(var(--notes-h, 120px) + 12px)' } : undefined}>
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
          <IconButton label="Zoom out (⌘−)" size="sm" onClick={() => zoomStep('out')} disabled={tb.scale <= ZOOM_STEPS[0] + 0.001}>
            <Minus size={14} />
          </IconButton>
          <button type="button" className="icon-btn sm readout" title={platform.shortcut('Fit to window (⌘0)')} onClick={() => zoomStep('fit')}>
            {formatZoom(tb.scale)}
          </button>
          <IconButton label="Zoom in (⌘+)" size="sm" onClick={() => zoomStep('in')} disabled={tb.scale >= ZOOM_STEPS[ZOOM_STEPS.length - 1] - 0.001}>
            <Plus size={14} />
          </IconButton>
          <span className="sep" />
          <IconButton label={withKeys(notesOpen ? 'Hide speaker notes' : 'Show speaker notes', 'pptx.notes')} size="sm" active={notesOpen} onClick={() => setNotesOpen(!notesOpen)}>
            <StickyNote size={14} />
          </IconButton>
          <IconButton label={withKeys('Present', 'pptx.present')} size="sm" onClick={() => setPresenting(activeIndex)}>
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

function containsId(el: Element, id: string): boolean {
  const children = (el as { children?: Element[] }).children
  return !!children?.some((c) => c.id === id || containsId(c, id))
}

/** Zoom levels for the buttons and keys, relative to fitting the slide in the window. */
const ZOOM_STEPS = [0.25, 0.33, 0.5, 0.67, 0.75, 0.9, 1, 1.1, 1.25, 1.5, 1.75, 2, 2.5, 3, 4]

/** Typing somewhere: a text box, a field, or text being edited on the slide. */
function isTextTarget(target: EventTarget | null) {
  const el = target instanceof HTMLElement ? target : null
  return !!el && (el.isContentEditable || !!el.closest('input, textarea, select'))
}

function readAsDataUrl(file: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(String(reader.result))
    reader.onerror = () => reject(reader.error)
    reader.readAsDataURL(file)
  })
}

/**
 * Read an image for the slide. One far bigger than the slide could ever show (a phone photo,
 * a Retina screenshot) is scaled down to twice the slide's size, which keeps the slide, its
 * thumbnail and the saved file quick. Smaller ones are kept byte for byte.
 */
async function loadImage(file: File, canvas: { width: number; height: number }) {
  const bitmap = await createImageBitmap(file).catch(() => null)
  if (!bitmap) return { dataUrl: await readAsDataUrl(file), width: 400, height: 300 }
  const { width, height } = bitmap
  const scale = Math.min(1, (canvas.width * 2) / width, (canvas.height * 2) / height)
  if (scale > 0.75 || file.type === 'image/gif' || file.type === 'image/svg+xml') {
    bitmap.close()
    return { dataUrl: await readAsDataUrl(file), width, height }
  }
  const out = document.createElement('canvas')
  out.width = Math.round(width * scale)
  out.height = Math.round(height * scale)
  out.getContext('2d')!.drawImage(bitmap, 0, 0, out.width, out.height)
  bitmap.close()
  // Photos stay JPEG; anything that may have transparency stays PNG.
  const type = file.type === 'image/jpeg' ? 'image/jpeg' : 'image/png'
  return { dataUrl: out.toDataURL(type, 0.9), width: out.width, height: out.height }
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

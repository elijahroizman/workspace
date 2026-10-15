import {
  ArrowDownToLine,
  ArrowUpToLine,
  Copy,
  FilePlus2,
  Highlighter,
  ImagePlus,
  Minus,
  MousePointer2,
  MoveHorizontal,
  PenLine,
  Plus,
  RotateCcw,
  RotateCw,
  Scaling,
  Trash2,
  Type,
  FileOutput,
} from 'lucide-react'
import type { PDFDocumentProxy } from 'pdfjs-dist'
import * as pdfjs from 'pdfjs-dist'
import workerUrl from 'pdfjs-dist/build/pdf.worker.min.mjs?url'
import { EventBus, PDFFindController, PDFLinkService, PDFViewer } from 'pdfjs-dist/web/pdf_viewer.mjs'
import 'pdfjs-dist/web/pdf_viewer.css'
import { useCallback, useEffect, useRef, useState } from 'react'
import type { EditorProps } from '../../App'
import { FindBar, InspectorHeader, Workbench, formatZoom } from '../../components/Workbench'
import type { MenuEntry } from '../../components/ui'
import { CenterState, IconButton, PopoverMenu, Section, Segmented } from '../../components/ui'
import { wheelZoomFactor } from '../../lib/pinch'
import * as platform from '../../lib/platform'
import { registerEditor, useWorkspace } from '../../state/workspace'
import * as pages from './pages'
import { Outline, Thumbnails } from './Sidebar'
import './pdf.css'

pdfjs.GlobalWorkerOptions.workerSrc = workerUrl

const ASSETS = import.meta.env.DEV ? '/node_modules/pdfjs-dist/' : '/pdfjs/'
const { AnnotationEditorType: Tool, AnnotationEditorParamsType: Param } = pdfjs

/** Zooming stretches the drawn pages at once; pdf.js redraws them sharp this long after the last step. */
const ZOOM_REDRAW_DELAY = 250

const HIGHLIGHT_COLORS = ['#FFFF98', '#53FFBC', '#80EBFF', '#FFCBE6', '#FF4F5F']
const INK_COLORS = ['#000000', '#E5484D', '#2F6FED', '#1F9D55', '#F5A524']

type ToolId = 'select' | 'highlight' | 'text' | 'draw' | 'image'
const TOOLS: { id: ToolId; mode: number; label: string; icon: React.ReactNode; hint: string }[] = [
  { id: 'select', mode: Tool.NONE, label: 'Select', icon: <MousePointer2 size={15} />, hint: 'Select text and annotations' },
  { id: 'highlight', mode: Tool.HIGHLIGHT, label: 'Highlight', icon: <Highlighter size={15} />, hint: 'Select text to highlight it' },
  { id: 'text', mode: Tool.FREETEXT, label: 'Text', icon: <Type size={15} />, hint: 'Click on a page to add text' },
  { id: 'draw', mode: Tool.INK, label: 'Draw', icon: <PenLine size={15} />, hint: 'Draw freehand on a page, or sign your name' },
  { id: 'image', mode: Tool.STAMP, label: 'Image', icon: <ImagePlus size={15} />, hint: 'Place an image on a page' },
]

interface DocInfo {
  title?: string
  author?: string
  producer?: string
  version?: string
  pageSize?: string
}

export default function PdfEditor({ tab, active }: EditorProps) {
  const containerRef = useRef<HTMLDivElement>(null)
  const viewerRef = useRef<PDFViewer | null>(null)
  const busRef = useRef<EventBus | null>(null)
  const linkRef = useRef<PDFLinkService | null>(null)
  const docRef = useRef<PDFDocumentProxy | null>(null)
  /** The PDF as of the last page operation (annotations live in pdf.js until saved). */
  const bytesRef = useRef<Uint8Array>(tab.bytes ?? new Uint8Array())
  const pageOpsDirty = useRef(false)
  /** pdf.js only reports transitions, so remember whether annotations changed since load/save. */
  const annotationsDirty = useRef(false)

  const [doc, setDoc] = useState<PDFDocumentProxy | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [password, setPassword] = useState<{ retry: boolean; submit: (pw: string) => void } | null>(null)
  const [page, setPage] = useState(1)
  const [scale, setScale] = useState(1)
  const [tool, setTool] = useState<ToolId>('select')
  const [highlightColor, setHighlightColor] = useState(HIGHLIGHT_COLORS[0])
  const [inkColor, setInkColor] = useState(INK_COLORS[0])
  const [inkThickness, setInkThickness] = useState(2)
  const [fontSize, setFontSize] = useState(12)
  const [sideTab, setSideTab] = useState<'pages' | 'outline'>('pages')
  const [info, setInfo] = useState<DocInfo>({})
  const [busy, setBusy] = useState(false)
  const [findOpen, setFindOpen] = useState(false)
  const [matches, setMatches] = useState<{ current: number; total: number } | null>(null)
  const [menu, setMenu] = useState<{ x: number; y: number; index: number } | null>(null)
  const findQuery = useRef('')
  const markDirty = useWorkspace((s) => s.markDirty)

  const refreshDirty = useCallback(() => {
    markDirty(tab.id, pageOpsDirty.current || annotationsDirty.current)
  }, [markDirty, tab.id])

  // ── Viewer lifecycle (one per tab)
  useEffect(() => {
    const container = containerRef.current!
    const eventBus = new EventBus()
    const linkService = new PDFLinkService({ eventBus })
    const findController = new PDFFindController({ eventBus, linkService })
    const viewer = new PDFViewer({
      container,
      eventBus,
      linkService,
      findController,
      annotationEditorMode: Tool.NONE,
      annotationEditorHighlightColors: HIGHLIGHT_COLORS.map((c, i) => `${['yellow', 'green', 'blue', 'pink', 'red'][i]}=${c}`).join(','),
      imageResourcesPath: `${ASSETS}web/images/`,
      supportsPinchToZoom: true,
      // Cap a single page bitmap at 16 MP; pdf.js draws a sharp detail layer for the visible
      // area when zoomed in further, so nothing gets blurry.
      maxCanvasPixels: 2 ** 24,
    })
    linkService.setViewer(viewer)
    viewerRef.current = viewer
    busRef.current = eventBus
    linkRef.current = linkService

    eventBus.on('pagechanging', (e: { pageNumber: number }) => setPage(e.pageNumber))
    eventBus.on('scalechanging', (e: { scale: number }) => setScale(e.scale))
    eventBus.on('updatefindmatchescount', (e: { matchesCount: { current: number; total: number } }) => setMatches(e.matchesCount))
    eventBus.on('updatefindcontrolstate', (e: { matchesCount?: { current: number; total: number } }) => {
      if (e.matchesCount) setMatches(e.matchesCount)
    })
    eventBus.on('annotationeditormodechanged', (e: { mode: number }) => {
      const t = TOOLS.find((x) => x.mode === e.mode)
      setTool(t?.id ?? 'select')
    })

    // Web links open in the default browser instead of a new webview window.
    const onClick = (e: MouseEvent) => {
      const a = (e.target as HTMLElement).closest('a')
      const href = a?.getAttribute('href')
      if (a && href && /^(https?:|mailto:)/i.test(href)) {
        e.preventDefault()
        e.stopPropagation()
        void platform.openExternal(href)
      }
    }
    container.addEventListener('click', onClick, true)

    // Trackpad pinch: WebKit sends gesture events, Chromium sends ctrl+wheel. pdf.js scales the
    // pages with CSS while the fingers move and re-renders once they stop (drawingDelay), which
    // keeps pinching smooth on large documents. Events can outpace the screen, and each one
    // re-lays out every page, so apply at most one zoom per frame.
    let gestureStart = 1
    let gestureActive = false
    let pending: { factor: number; origin: [number, number] } | null = null
    let frame = 0
    const zoomBy = (factor: number, origin: [number, number]) => {
      pending = { factor: (pending?.factor ?? 1) * factor, origin }
      frame ||= requestAnimationFrame(() => {
        frame = 0
        if (!pending) return
        const scaleFactor = Math.min(10, Math.max(0.1, viewer.currentScale * pending.factor)) / viewer.currentScale
        viewer.updateScale({ drawingDelay: ZOOM_REDRAW_DELAY, scaleFactor, origin: pending.origin })
        pending = null
      })
    }
    const onGestureStart = (e: Event) => {
      e.preventDefault()
      gestureActive = true
      gestureStart = viewer.currentScale
    }
    const onGestureChange = (e: Event) => {
      e.preventDefault()
      const ge = e as Event & { scale: number; clientX: number; clientY: number }
      // Gesture scale is relative to the start; turn it into a step from where the zoom will be.
      const target = gestureStart * ge.scale
      const current = viewer.currentScale * (pending?.factor ?? 1)
      zoomBy(target / current, [ge.clientX, ge.clientY])
    }
    const onGestureEnd = (e: Event) => {
      e.preventDefault()
      gestureActive = false
    }
    const onWheel = (e: WheelEvent) => {
      if (!e.ctrlKey || gestureActive) return
      e.preventDefault()
      zoomBy(wheelZoomFactor(e), [e.clientX, e.clientY])
    }
    // Re-fit "auto"/"page-width"/"page-fit" zoom when the canvas changes size: window resizes,
    // sidebars toggling, or the tab first becoming visible after loading in the background.
    let lastWidth = container.clientWidth
    const resize = new ResizeObserver(() => {
      const width = container.clientWidth
      if (!width || width === lastWidth || !viewer.pdfDocument) return
      lastWidth = width
      const preset = viewer.currentScaleValue
      if (['auto', 'page-width', 'page-fit'].includes(preset)) viewer.currentScaleValue = preset
      else viewer.update()
    })
    resize.observe(container)

    container.addEventListener('gesturestart', onGestureStart)
    container.addEventListener('gesturechange', onGestureChange)
    container.addEventListener('gestureend', onGestureEnd)
    container.addEventListener('wheel', onWheel, { passive: false })

    return () => {
      cancelAnimationFrame(frame)
      resize.disconnect()
      container.removeEventListener('click', onClick, true)
      container.removeEventListener('gesturestart', onGestureStart)
      container.removeEventListener('gesturechange', onGestureChange)
      container.removeEventListener('gestureend', onGestureEnd)
      container.removeEventListener('wheel', onWheel)
      viewer.setDocument(null as unknown as PDFDocumentProxy)
      if (viewerRef.current === viewer) viewerRef.current = null
      loadGeneration.current++
      void docRef.current?.loadingTask.destroy()
      docRef.current = null
    }
  }, [])

  /** (Re)load the PDF into the viewer, optionally staying on the same page and zoom. */
  const loadGeneration = useRef(0)
  const pendingFit = useRef<string | null>(null)
  const load = useCallback(
    async (bytes: Uint8Array, keepView = false) => {
      const generation = ++loadGeneration.current
      const before = viewerRef.current
      const prev = { page: before?.currentPageNumber ?? 1, scale: before?.currentScaleValue ?? 'auto' }
      setError(null)
      const task = pdfjs.getDocument({
        data: bytes.slice(), // pdf.js transfers the buffer to its worker; keep ours intact
        cMapUrl: `${ASSETS}cmaps/`,
        cMapPacked: true,
        standardFontDataUrl: `${ASSETS}standard_fonts/`,
        wasmUrl: `${ASSETS}wasm/`,
        iccUrl: `${ASSETS}iccs/`,
        enableXfa: true,
      })
      task.onPassword = (submit: (pw: string) => void, reason: number) => {
        setPassword({ retry: reason === pdfjs.PasswordResponses.INCORRECT_PASSWORD, submit })
      }
      try {
        const next = await task.promise
        const viewer = viewerRef.current
        // A newer load (or unmount) superseded this one.
        if (generation !== loadGeneration.current || !viewer) {
          void task.destroy()
          return
        }
        setPassword(null)
        const old = docRef.current
        docRef.current = next
        annotationsDirty.current = false
        const storage = next.annotationStorage as unknown as { onSetModified: () => void; onResetModified: () => void }
        storage.onSetModified = () => {
          annotationsDirty.current = true
          refreshDirty()
        }
        storage.onResetModified = () => {
          annotationsDirty.current = false
          refreshDirty()
        }
        const onInit = () => {
          busRef.current?.off('pagesinit', onInit)
          if (keepView) {
            viewer.currentScaleValue = prev.scale
            viewer.currentPageNumber = Math.min(prev.page, next.numPages)
          } else if (containerRef.current?.offsetParent) {
            viewer.currentScaleValue = 'auto'
          } else {
            // Hidden tab: laying out now would measure a zero-size canvas. Fit when shown.
            pendingFit.current = 'auto'
          }
        }
        busRef.current!.on('pagesinit', onInit)
        viewer.setDocument(next)
        linkRef.current!.setDocument(next, null)
        setDoc(next)
        void old?.loadingTask.destroy()
        void readInfo(next).then(setInfo)
      } catch (err) {
        setPassword(null)
        setError(err instanceof Error ? err.message : String(err))
      }
    },
    [refreshDirty],
  )

  useEffect(() => {
    void load(bytesRef.current)
  }, [load])

  // ── Annotation tools
  const selectTool = (id: ToolId) => {
    const t = TOOLS.find((x) => x.id === id)!
    try {
      viewerRef.current!.annotationEditorMode = { mode: t.mode }
      setTool(id)
    } catch (err) {
      console.warn(err)
    }
  }

  const setParam = (type: number, value: unknown) => busRef.current?.dispatch('switchannotationeditorparams', { source: null, type, value })

  // ── Page operations go through pdf-lib, then reload.
  const currentBytes = async () => {
    const d = docRef.current
    return d && annotationsDirty.current ? new Uint8Array(await d.saveDocument()) : bytesRef.current
  }

  const pageOp = async (op: (bytes: Uint8Array) => Promise<Uint8Array>, goTo?: number) => {
    if (busy) return
    setBusy(true)
    try {
      const next = await op(await currentBytes())
      bytesRef.current = next
      pageOpsDirty.current = true
      await load(next, true)
      if (goTo) setTimeout(() => (viewerRef.current!.currentPageNumber = goTo), 0)
      markDirty(tab.id, true)
    } catch (err) {
      await platform.showError(err instanceof Error ? err.message : String(err))
    } finally {
      setBusy(false)
    }
  }

  const insertFromFile = async (afterIndex: number) => {
    const files = (await platform.pickFiles()).filter((f) => f.name.toLowerCase().endsWith('.pdf'))
    if (!files.length) return
    await pageOp(async (bytes) => {
      let out = bytes
      let at = afterIndex
      for (const f of files) {
        const before = (await pdfjs.getDocument({ data: f.bytes.slice() }).promise).numPages
        out = await pages.insertPdf(out, f.bytes, at)
        at += before
      }
      return out
    }, afterIndex + 2)
  }

  const extract = async (indices: number[]) => {
    try {
      const bytes = await pages.extractPages(await currentBytes(), indices)
      const name = `${tab.title} (page${indices.length > 1 ? 's' : ''} ${indices.map((i) => i + 1).join(', ')})`
      const path = await platform.pickSavePath(name, 'pdf')
      if (path) await platform.writeFile(path, bytes)
    } catch (err) {
      await platform.showError(String(err))
    }
  }

  const pageMenu = (index: number): MenuEntry[] => [
    { label: 'Rotate Right', icon: <RotateCw size={14} />, onSelect: () => void pageOp((b) => pages.rotatePages(b, [index], 90)) },
    { label: 'Rotate Left', icon: <RotateCcw size={14} />, onSelect: () => void pageOp((b) => pages.rotatePages(b, [index], -90)) },
    { label: 'Duplicate', icon: <Copy size={14} />, onSelect: () => void pageOp((b) => pages.duplicatePage(b, index), index + 2), separatorBefore: true },
    { label: 'Insert Blank Page After', icon: <FilePlus2 size={14} />, onSelect: () => void pageOp((b) => pages.insertBlankPage(b, index), index + 2) },
    { label: 'Insert Pages from File…', icon: <ArrowDownToLine size={14} />, onSelect: () => void insertFromFile(index) },
    { label: 'Extract as PDF…', icon: <FileOutput size={14} />, onSelect: () => void extract([index]), separatorBefore: true },
    { label: 'Delete Page', icon: <Trash2 size={14} />, danger: true, onSelect: () => void pageOp((b) => pages.deletePages(b, [index])), separatorBefore: true },
  ]

  // ── Find
  const find = (query: string, previous = false, again = false) => {
    findQuery.current = query
    busRef.current?.dispatch('find', {
      source: null,
      type: again ? 'again' : '',
      query,
      caseSensitive: false,
      entireWord: false,
      highlightAll: true,
      findPrevious: previous,
      matchDiacritics: false,
    })
    if (!query) setMatches(null)
  }

  // ── Shell integration
  useEffect(
    () =>
      registerEditor(tab.id, {
        getBytes: async () => {
          const bytes = await currentBytes()
          return bytes
        },
        markSaved: () => {
          // The saved file now contains the annotations; reload so pdf.js treats them as part of the document.
          void currentBytes().then((bytes) => {
            bytesRef.current = bytes
            pageOpsDirty.current = false
            docRef.current?.annotationStorage.resetModified()
            annotationsDirty.current = false
            markDirty(tab.id, false)
          })
        },
        find: () => setFindOpen(true),
        zoom: (dir) => {
          const v = viewerRef.current
          if (!v) return
          if (dir === 'in') v.increaseScale({ drawingDelay: ZOOM_REDRAW_DELAY })
          else if (dir === 'out') v.decreaseScale({ drawingDelay: ZOOM_REDRAW_DELAY })
          else v.currentScaleValue = 'page-actual'
        },
        print: () => printPdf(currentBytes),
      }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [tab.id],
  )

  useEffect(() => {
    const v = viewerRef.current
    if (!active) {
      // Rendered pages are large bitmaps (tens of MB each on a Retina screen). Let them go when
      // the tab has been in the background for a while; visible pages redraw on return.
      const timer = window.setTimeout(() => {
        const viewer = viewerRef.current
        if (!viewer?.pdfDocument) return
        for (let i = 0; i < viewer.pagesCount; i++) viewer.getPageView(i)?.reset()
        void viewer.pdfDocument.cleanup()
      }, 30_000)
      return () => window.clearTimeout(timer)
    }
    containerRef.current?.focus({ preventScroll: true })
    if (v?.pdfDocument) {
      if (pendingFit.current) v.currentScaleValue = pendingFit.current
      v.update()
    }
    pendingFit.current = null
  }, [active])

  const numPages = doc?.numPages ?? 0
  const currentTool = TOOLS.find((t) => t.id === tool)!

  const left = (
    <>
      <div className="sidebar-tabs">
        <Segmented
          value={sideTab}
          onChange={setSideTab}
          options={[
            { value: 'pages', label: 'Pages' },
            { value: 'outline', label: 'Outline' },
          ]}
        />
      </div>
      {doc &&
        (sideTab === 'pages' ? (
          <Thumbnails
            doc={doc}
            current={page}
            onSelect={(n) => linkRef.current?.goToPage(n)}
            onMenu={(index, x, y) => setMenu({ index, x, y })}
            onMove={(from, to) => void pageOp((b) => pages.movePage(b, from, to), to + 1)}
            active={active}
          />
        ) : (
          <Outline doc={doc} onNavigate={(dest) => void linkRef.current?.goToDestination(dest)} />
        ))}
    </>
  )

  const right = (
    <>
      <InspectorHeader kind="pdf">PDF</InspectorHeader>
      <Section title="Annotate">
        <div className="tool-grid">
          {TOOLS.map((t) => (
            <button key={t.id} type="button" className={`tool-btn ${tool === t.id ? 'on' : ''}`} title={t.hint} onClick={() => selectTool(t.id)} disabled={!doc}>
              {t.icon}
              <span>{t.label}</span>
            </button>
          ))}
        </div>
        <p className="tool-hint faint">{currentTool.hint}.</p>
        {tool === 'highlight' && (
          <div className="swatches">
            {HIGHLIGHT_COLORS.map((c) => (
              <button
                key={c}
                type="button"
                aria-label={`Highlight color ${c}`}
                className={`swatch ${highlightColor === c ? 'on' : ''}`}
                style={{ background: c }}
                onClick={() => {
                  setHighlightColor(c)
                  setParam(Param.HIGHLIGHT_COLOR, c)
                }}
              />
            ))}
          </div>
        )}
        {(tool === 'draw' || tool === 'text') && (
          <>
            <div className="swatches">
              {INK_COLORS.map((c) => (
                <button
                  key={c}
                  type="button"
                  aria-label={`Color ${c}`}
                  className={`swatch ${inkColor === c ? 'on' : ''}`}
                  style={{ background: c }}
                  onClick={() => {
                    setInkColor(c)
                    setParam(tool === 'draw' ? Param.INK_COLOR : Param.FREETEXT_COLOR, c)
                  }}
                />
              ))}
            </div>
            {tool === 'draw' ? (
              <label className="slider-row">
                <span className="muted">Thickness</span>
                <input
                  type="range"
                  min={1}
                  max={20}
                  value={inkThickness}
                  onChange={(e) => {
                    setInkThickness(Number(e.currentTarget.value))
                    setParam(Param.INK_THICKNESS, Number(e.currentTarget.value))
                  }}
                />
                <span className="value">{inkThickness}</span>
              </label>
            ) : (
              <label className="slider-row">
                <span className="muted">Size</span>
                <input
                  type="range"
                  min={6}
                  max={72}
                  value={fontSize}
                  onChange={(e) => {
                    setFontSize(Number(e.currentTarget.value))
                    setParam(Param.FREETEXT_SIZE, Number(e.currentTarget.value))
                  }}
                />
                <span className="value">{fontSize}</span>
              </label>
            )}
          </>
        )}
      </Section>
      <Section title={numPages ? `Page ${page} of ${numPages}` : 'Page'}>
        <div className="grid-2">
          <button type="button" className="btn" disabled={!doc || busy} onClick={() => void pageOp((b) => pages.rotatePages(b, [page - 1], -90))}>
            <RotateCcw size={14} /> Rotate
          </button>
          <button type="button" className="btn" disabled={!doc || busy} onClick={() => void pageOp((b) => pages.rotatePages(b, [page - 1], 90))}>
            <RotateCw size={14} /> Rotate
          </button>
          <button type="button" className="btn" disabled={!doc || busy || page <= 1} onClick={() => void pageOp((b) => pages.movePage(b, page - 1, page - 2), page - 1)}>
            <ArrowUpToLine size={14} /> Move up
          </button>
          <button type="button" className="btn" disabled={!doc || busy || page >= numPages} onClick={() => void pageOp((b) => pages.movePage(b, page - 1, page), page + 1)}>
            <ArrowDownToLine size={14} /> Move down
          </button>
          <button type="button" className="btn" disabled={!doc || busy} onClick={() => void pageOp((b) => pages.duplicatePage(b, page - 1), page + 1)}>
            <Copy size={14} /> Duplicate
          </button>
          <button type="button" className="btn danger" disabled={!doc || busy || numPages <= 1} onClick={() => void pageOp((b) => pages.deletePages(b, [page - 1]))}>
            <Trash2 size={14} /> Delete
          </button>
        </div>
        <button type="button" className="btn block" disabled={!doc || busy} onClick={() => void insertFromFile(page - 1)}>
          <FilePlus2 size={14} /> Insert pages from file…
        </button>
        <button type="button" className="btn block" disabled={!doc || busy} onClick={() => void extract([page - 1])}>
          <FileOutput size={14} /> Extract page as PDF…
        </button>
      </Section>
      <Section title="Document" collapsible>
        <dl className="stats">
          {info.title && (
            <>
              <dt>Title</dt>
              <dd className="ellipsis" title={info.title}>
                {info.title}
              </dd>
            </>
          )}
          {info.author && (
            <>
              <dt>Author</dt>
              <dd className="ellipsis">{info.author}</dd>
            </>
          )}
          <dt>Pages</dt>
          <dd>{numPages}</dd>
          {info.pageSize && (
            <>
              <dt>Page size</dt>
              <dd>{info.pageSize}</dd>
            </>
          )}
          <dt>File size</dt>
          <dd>{formatBytes(bytesRef.current.byteLength)}</dd>
          {info.version && (
            <>
              <dt>PDF version</dt>
              <dd>{info.version}</dd>
            </>
          )}
          {info.producer && (
            <>
              <dt>Created with</dt>
              <dd className="ellipsis" title={info.producer}>
                {info.producer}
              </dd>
            </>
          )}
        </dl>
      </Section>
    </>
  )

  return (
    <Workbench tab={tab} left={left} right={right} leftFooter={numPages ? <span>{numPages === 1 ? '1 page' : `${numPages} pages`}</span> : undefined}>
      <div className={`pdf-stage tool-${tool}`}>
        <div ref={containerRef} className="pdf-container" tabIndex={-1}>
          <div className="pdfViewer" />
        </div>
      </div>
      {error && (
        <CenterState title="Couldn’t open this PDF">
          <p className="muted">{error}</p>
        </CenterState>
      )}
      {password && <PasswordPrompt retry={password.retry} onSubmit={password.submit} />}
      <FindBar
        open={findOpen}
        onClose={() => {
          setFindOpen(false)
          find('')
        }}
        onQuery={(q) => find(q)}
        onNext={() => find(findQuery.current, false, true)}
        onPrev={() => find(findQuery.current, true, true)}
        count={matches?.total ?? null}
        current={matches ? Math.max(0, matches.current - 1) : null}
        placeholder="Find in PDF"
      />
      {doc && (
        <div className="canvas-bar">
          <input
            className="readout"
            aria-label="Page number"
            key={page}
            defaultValue={page}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                const n = Number(e.currentTarget.value)
                if (n >= 1 && n <= numPages) linkRef.current?.goToPage(n)
                e.currentTarget.blur()
              }
            }}
          />
          <span className="faint" style={{ paddingRight: 8 }}>
            / {numPages}
          </span>
          <span className="sep" />
          <IconButton label="Zoom out (⌘−)" size="sm" onClick={() => viewerRef.current?.decreaseScale({ drawingDelay: ZOOM_REDRAW_DELAY })}>
            <Minus size={14} />
          </IconButton>
          <button type="button" className="icon-btn sm readout" title={platform.shortcut('Actual size (⌘0)')} onClick={() => (viewerRef.current!.currentScaleValue = 'page-actual')}>
            {formatZoom(scale)}
          </button>
          <IconButton label="Zoom in (⌘+)" size="sm" onClick={() => viewerRef.current?.increaseScale({ drawingDelay: ZOOM_REDRAW_DELAY })}>
            <Plus size={14} />
          </IconButton>
          <span className="sep" />
          <IconButton label="Fit width" size="sm" onClick={() => (viewerRef.current!.currentScaleValue = 'page-width')}>
            <MoveHorizontal size={14} />
          </IconButton>
          <IconButton label="Fit page" size="sm" onClick={() => (viewerRef.current!.currentScaleValue = 'page-fit')}>
            <Scaling size={14} />
          </IconButton>
        </div>
      )}
      {menu && <PopoverMenu anchor={menu} items={pageMenu(menu.index)} onClose={() => setMenu(null)} />}
    </Workbench>
  )
}

function PasswordPrompt({ retry, onSubmit }: { retry: boolean; onSubmit: (pw: string) => void }) {
  const [value, setValue] = useState('')
  return (
    <div className="center-state">
      <form
        className="box password-box"
        onSubmit={(e) => {
          e.preventDefault()
          onSubmit(value)
        }}
      >
        <h3>This PDF is password protected</h3>
        {retry && <p style={{ color: 'var(--danger)', margin: 0 }}>That password didn’t work. Try again.</p>}
        <label className="field" style={{ width: 260 }}>
          <input type="password" autoFocus placeholder="Password" value={value} onChange={(e) => setValue(e.currentTarget.value)} />
        </label>
        <button type="submit" className="btn primary">
          Unlock
        </button>
      </form>
    </div>
  )
}

async function readInfo(doc: PDFDocumentProxy): Promise<DocInfo> {
  const [meta, first] = await Promise.all([doc.getMetadata().catch(() => null), doc.getPage(1)])
  const info = (meta?.info ?? {}) as Record<string, unknown>
  const vp = first.getViewport({ scale: 1, rotation: 0 })
  return {
    title: (meta?.metadata?.get('dc:title') as string | undefined) || (info.Title as string | undefined) || undefined,
    author: (info.Author as string | undefined) || undefined,
    producer: (info.Creator as string | undefined) || (info.Producer as string | undefined) || undefined,
    version: info.PDFFormatVersion as string | undefined,
    pageSize: pageSizeName(vp.width, vp.height),
  }
}

function pageSizeName(w: number, h: number) {
  const [a, b] = [Math.min(w, h), Math.max(w, h)]
  const near = (x: number, y: number) => Math.abs(x - y) < 3
  if (near(a, 612) && near(b, 792)) return 'US Letter'
  if (near(a, 612) && near(b, 1008)) return 'US Legal'
  if (near(a, 595) && near(b, 842)) return 'A4'
  if (near(a, 420) && near(b, 595)) return 'A5'
  if (near(a, 842) && near(b, 1191)) return 'A3'
  return `${Math.round((w / 72) * 25.4)} × ${Math.round((h / 72) * 25.4)} mm`
}

function formatBytes(n: number) {
  if (n < 1024) return `${n} B`
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(0)} KB`
  return `${(n / 1024 / 1024).toFixed(1)} MB`
}

/** Render each page to an image in the print root, then open the system print panel. */
async function printPdf(getBytes: () => Promise<Uint8Array>) {
  const root = document.getElementById('print-root')!
  root.innerHTML = ''
  const doc = await pdfjs.getDocument({ data: (await getBytes()).slice() }).promise
  try {
    for (let i = 1; i <= doc.numPages; i++) {
      const page = await doc.getPage(i)
      const viewport = page.getViewport({ scale: 2 })
      const canvas = document.createElement('canvas')
      canvas.width = viewport.width
      canvas.height = viewport.height
      await page.render({ canvas, viewport, annotationMode: pdfjs.AnnotationMode.ENABLE_STORAGE }).promise
      const blob = await new Promise<Blob | null>((r) => canvas.toBlob(r, 'image/png'))
      const div = document.createElement('div')
      div.className = 'print-page'
      const img = new Image()
      img.src = blob ? URL.createObjectURL(blob) : canvas.toDataURL()
      div.appendChild(img)
      root.appendChild(div)
      page.cleanup()
    }
    await Promise.all(Array.from(root.querySelectorAll('img')).map((img) => img.decode().catch(() => {})))
    window.print()
  } finally {
    void doc.loadingTask.destroy()
  }
}

// The Mermaid editor: source on the left, the diagram on the right, redrawn a moment after
// typing stops. A syntax error keeps the last good diagram up and says what's wrong. The sidebar
// has the diagram's exports, templates and errors.

import mermaid from 'mermaid'
import type { PluginEditor, PluginEditorContext, Theme } from '../../src/plugins/api'
import { encode, mountSourcePreview, sidebarHint, sidebarItem, sidebarSection } from '../shared/source-preview'
import { highlight, mermaidLanguage } from './language'
import css from './mermaid.css?inline'
import { TEMPLATES } from './templates'

const BLANK = `flowchart TD
  A[Start] --> B{Is it working?}
  B -->|Yes| C[Great]
  B -->|No| D[Fix it]
  D --> B
`

const MIN_ZOOM = 0.1
const MAX_ZOOM = 5
const STEPS = [0.25, 0.5, 0.67, 0.8, 1, 1.25, 1.5, 2, 3, 4, 5]

let styled = false
let ids = 0

interface Problem {
  message: string
  line?: number
}

const el = <K extends keyof HTMLElementTagNameMap>(tag: K, className?: string, text?: string) => {
  const node = document.createElement(tag)
  if (className) node.className = className
  if (text) node.textContent = text
  return node
}

/** Mermaid's config is global; every render sets the one it needs (tabs may differ in nothing but timing). */
function configure(theme: Theme, forExport = false) {
  mermaid.initialize({
    startOnLoad: false,
    securityLevel: 'strict',
    theme: theme === 'dark' ? 'dark' : 'default',
    fontFamily: 'ui-sans-serif, -apple-system, "Segoe UI", sans-serif',
    // HTML labels are <foreignObject>s, which WebKit won't draw into a canvas; exports to PNG
    // use plain SVG text.
    htmlLabels: !forExport,
    flowchart: { htmlLabels: !forExport },
  })
}

/** Renders off-screen; Mermaid leaves its scratch elements in <body> when it fails. */
async function renderSvg(text: string, theme: Theme, forExport = false): Promise<string> {
  const id = `ws-mermaid-${++ids}`
  configure(theme, forExport)
  try {
    return (await mermaid.render(id, text)).svg
  } finally {
    for (const stray of [id, `d${id}`, `i${id}`]) document.getElementById(stray)?.remove()
  }
}

function problemFrom(err: unknown): Problem {
  const e = err as { message?: string; str?: string; hash?: { loc?: { first_line?: number }; line?: number } }
  const raw = (e?.message ?? e?.str ?? String(err)).trim()
  const line = e?.hash?.loc?.first_line ?? (e?.hash?.line !== undefined ? e.hash.line + 1 : undefined) ?? Number(/line (\d+)/i.exec(raw)?.[1]) ?? undefined
  const lines = raw.split('\n')
  let message = lines[0]
  // "Parse error on line 9:", then the line, a caret under the spot, and the tokens it expected.
  // Where the caret points says more than the token names.
  const caret = lines.findIndex((l) => /^-*\^\s*$/.test(l))
  if (/^Parse error on line \d+:?$/.test(message.trim()) && caret > 0) {
    const near = lines[caret - 1].slice(lines[caret].indexOf('^')).trim()
    message = near ? `Mermaid can’t read “${near.length > 30 ? `${near.slice(0, 30)}…` : near}”` : 'Mermaid can’t read this line'
  }
  return { message: message.replace(/^Error:\s*/, ''), line: Number.isFinite(line) && line ? line : undefined }
}

/** The SVG's own size, from its viewBox (Mermaid sets width="100%" and a max-width). */
function naturalSize(svg: SVGSVGElement) {
  const box = svg.viewBox.baseVal
  if (box && box.width && box.height) return { width: box.width, height: box.height }
  const rect = svg.getBoundingClientRect()
  return { width: rect.width || 400, height: rect.height || 300 }
}

/** A standalone SVG file: namespaced, with a real size instead of 100%. */
function standalone(markup: string): string {
  const svg = new DOMParser().parseFromString(markup, 'text/html').querySelector('svg')!
  const box = svg.getAttribute('viewBox')?.split(/[\s,]+/).map(Number)
  if (box?.length === 4) {
    svg.setAttribute('width', String(Math.ceil(box[2])))
    svg.setAttribute('height', String(Math.ceil(box[3])))
  }
  svg.style.removeProperty('max-width')
  svg.setAttribute('xmlns', 'http://www.w3.org/2000/svg')
  return new XMLSerializer().serializeToString(svg)
}

function base64(text: string) {
  const bytes = new TextEncoder().encode(text)
  let binary = ''
  for (let i = 0; i < bytes.length; i += 0x8000) binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000))
  return btoa(binary)
}

async function toPng(svgText: string, background: string): Promise<Uint8Array> {
  const image = new Image()
  // A data: URL, not blob:, so the canvas isn't tainted in WebKit.
  image.src = `data:image/svg+xml;base64,${base64(svgText)}`
  await image.decode()
  const scale = 2
  const canvas = document.createElement('canvas')
  canvas.width = Math.max(1, Math.round(image.naturalWidth * scale))
  canvas.height = Math.max(1, Math.round(image.naturalHeight * scale))
  const ctx = canvas.getContext('2d')!
  ctx.fillStyle = background
  ctx.fillRect(0, 0, canvas.width, canvas.height)
  ctx.drawImage(image, 0, 0, canvas.width, canvas.height)
  const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/png'))
  if (!blob) throw new Error('Couldn’t make the picture.')
  return new Uint8Array(await blob.arrayBuffer())
}

export function mountEditor(element: HTMLElement, context: PluginEditorContext): PluginEditor {
  if (!styled) {
    styled = true
    const style = el('style')
    style.dataset.workspacePlugin = 'mermaid'
    style.textContent = css
    document.head.appendChild(style)
  }
  let theme = context.theme
  let destroyed = false
  let generation = 0
  /** The SVG markup on screen: the last diagram that drew. */
  let shown: string | null = null
  let problem: Problem | null = null
  /** null: fit the pane (never above 100%). */
  let zoom: number | null = null

  const kit = mountSourcePreview({
    element,
    context,
    blank: BLANK,
    language: mermaidLanguage,
    highlight,
    lineNumbers: true,
    placeholder: 'flowchart TD …',
    delay: () => 250,
    onIdle: (text) => void draw(text),
  })

  const stage = el('div', 'mm-stage')
  const canvas = el('div', 'mm-canvas')
  stage.appendChild(canvas)
  const message = el('div', 'sp-message tone-error')
  message.hidden = true
  kit.preview.append(stage, message)

  // ── Drawing

  async function draw(text: string) {
    const mine = ++generation
    if (!text.trim()) {
      canvas.replaceChildren(el('div', 'mm-empty', 'Write a diagram, or start from a template in the sidebar.'))
      shown = null
      setProblem(null)
      return
    }
    try {
      // parse() names the line; render() on bad input only says it failed.
      configure(theme)
      await mermaid.parse(text)
      const svg = await renderSvg(text, theme)
      if (mine !== generation || destroyed) return
      shown = svg
      canvas.innerHTML = svg // Mermaid's output, sanitized by it (securityLevel: strict)
      applyZoom()
      setProblem(null)
    } catch (err) {
      if (mine !== generation || destroyed) return
      setProblem(problemFrom(err))
    }
    refreshInfo(text)
  }

  function setProblem(next: Problem | null) {
    problem = next
    message.hidden = !next
    message.replaceChildren()
    if (next) {
      message.append(el('div', undefined, next.line ? `Line ${next.line}: ${next.message}` : next.message))
      if (next.line) {
        const button = el('button', 'btn', 'Show the line')
        button.type = 'button'
        button.addEventListener('click', () => kit.goToLine(next.line!))
        message.append(button)
      }
    }
    renderProblems()
  }

  // ── Zoom: the SVG gets a real width, so the pane scrolls over the whole diagram.

  function applyZoom(anchor?: { x: number; y: number }) {
    const svg = canvas.querySelector('svg')
    if (!svg) return
    const size = naturalSize(svg)
    const fit = Math.min(1, (stage.clientWidth - 48) / size.width, (stage.clientHeight - 48) / size.height)
    const scale = zoom ?? Math.max(MIN_ZOOM, fit)
    const before = { left: stage.scrollLeft, top: stage.scrollTop, width: canvas.offsetWidth, height: canvas.offsetHeight }
    svg.style.maxWidth = 'none'
    svg.style.width = `${size.width * scale}px`
    svg.style.height = `${size.height * scale}px`
    svg.removeAttribute('height')
    if (anchor && before.width) {
      // Keep the point under the cursor where it was.
      const ratio = canvas.offsetWidth / before.width
      stage.scrollLeft = (before.left + anchor.x) * ratio - anchor.x
      stage.scrollTop = (before.top + anchor.y) * (canvas.offsetHeight / Math.max(1, before.height)) - anchor.y
    }
  }

  const currentScale = () => {
    const svg = canvas.querySelector('svg')
    return svg ? svg.getBoundingClientRect().width / naturalSize(svg).width : 1
  }

  function setZoom(next: number | null, anchor?: { x: number; y: number }) {
    zoom = next === null ? null : Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, next))
    applyZoom(anchor)
  }

  stage.addEventListener(
    'wheel',
    (event) => {
      // Pinch on a trackpad arrives as a wheel with ctrlKey.
      if (!event.ctrlKey && !event.metaKey) return
      event.preventDefault()
      const rect = stage.getBoundingClientRect()
      setZoom(currentScale() * Math.exp(-event.deltaY * 0.01), { x: event.clientX - rect.left, y: event.clientY - rect.top })
    },
    { passive: false },
  )

  const resize = new ResizeObserver(() => zoom === null && applyZoom())
  resize.observe(stage)

  // ── Sidebar

  const sidebar = context.sidebar
  const info = el('div', 'mm-info')
  const svgButton = el('button', 'btn block', 'Export SVG…')
  const pngButton = el('button', 'btn block', 'Export PNG…')
  let problemsBody: HTMLElement | null = null

  if (sidebar) {
    const diagram = sidebarSection(sidebar, 'Diagram')
    const actions = el('div', 'sp-side-actions')
    svgButton.type = pngButton.type = 'button'
    actions.append(info, svgButton, pngButton)
    diagram.appendChild(actions)
    problemsBody = sidebarSection(sidebar, 'Errors')
    const templates = sidebarSection(sidebar, 'Start from a template')
    for (const [name, text] of Object.entries(TEMPLATES)) {
      templates.appendChild(
        sidebarItem(name, {
          // One transaction, so ⌘Z brings the old diagram back.
          onClick: () => kit.source.dispatch({ changes: { from: 0, to: kit.source.state.doc.length, insert: text } }),
        }),
      )
    }
    svgButton.addEventListener('click', () => void exportSvg())
    pngButton.addEventListener('click', () => void exportPng())
    if (!context.saveFile) svgButton.hidden = pngButton.hidden = true
  }

  function refreshInfo(text: string) {
    const type = /^\s*(?:%%.*\n\s*)*([A-Za-z][\w-]*)/.exec(text)?.[1]
    info.textContent = type ? `Type: ${type}` : ''
    svgButton.disabled = pngButton.disabled = !shown
  }

  function renderProblems() {
    if (!problemsBody) return
    problemsBody.replaceChildren(
      problem
        ? sidebarItem(problem.message, { tone: 'error', detail: problem.line ? `Line ${problem.line}` : undefined, onClick: () => problem?.line && kit.goToLine(problem.line) })
        : sidebarHint('No errors.'),
    )
  }

  const fileName = (ext: string) => `${context.title}.${ext}`

  async function exportSvg() {
    if (!shown) return
    await context.saveFile?.({ bytes: encode(standalone(shown)), name: fileName('svg') })
  }

  async function exportPng() {
    if (!shown) return
    try {
      const svg = standalone(await renderSvg(kit.text(), theme, true))
      const bytes = await toPng(svg, theme === 'dark' ? '#1e1e1e' : '#ffffff')
      await context.saveFile?.({ bytes, name: fileName('png') })
    } catch (err) {
      setProblem({ message: `Couldn’t export: ${problemFrom(err).message}` })
    } finally {
      configure(theme)
    }
  }

  renderProblems()
  refreshInfo(kit.text())

  return {
    getBytes: async () => encode(kit.text()),
    views: { read: 'Diagram', split: 'Source and diagram', write: 'Source' },
    setView(view) {
      kit.setView(view)
      // The pane changed size; a fitted diagram fits again.
      requestAnimationFrame(() => zoom === null && applyZoom())
    },
    find: () => kit.find(),
    setTheme(next) {
      theme = next
      void draw(kit.text())
    },
    zoom(direction) {
      if (direction === 'reset') return setZoom(null)
      const scale = currentScale()
      const next = direction === 'in' ? STEPS.find((s) => s > scale + 0.001) : [...STEPS].reverse().find((s) => s < scale - 0.001)
      setZoom(next ?? scale)
    },
    async print() {
      if (!shown) return
      const page = el('div', 'mm-print')
      page.innerHTML = standalone(shown)
      const svg = page.querySelector('svg')
      if (svg) {
        svg.removeAttribute('width')
        svg.removeAttribute('height')
        svg.style.maxWidth = '100%'
        svg.style.maxHeight = '100vh'
      }
      await context.print(page)
    },
    destroy() {
      destroyed = true
      resize.disconnect()
      kit.destroy()
      sidebar?.replaceChildren()
    },
  }
}

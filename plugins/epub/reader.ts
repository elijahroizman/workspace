// The EPUB reader: every section of the book in one scrolling column, each in its own shadow
// root, with the table of contents in Workspace's sidebar. Books are read, not edited, so the
// file is saved back exactly as it was opened.

import DOMPurify from 'dompurify'
import type { PluginEditor, PluginEditorContext, SearchResult, Theme } from '../../src/plugins/api'
import type { Book, TocEntry } from './book'
import { isExternal, openBook, parseMarkup, readText, resolveHref, resolvePath, safeDecode } from './book'
import bookCss from './book.css?inline'
import readerCss from './reader.css?inline'
import { Resources, Styles, withoutUrls } from './styles'

const [BASE_CSS, OVERRIDE_CSS] = bookCss.split('/* @overrides */')
const XLINK = 'http://www.w3.org/1999/xlink'
const SCALES = [0.7, 0.8, 0.9, 1, 1.1, 1.2, 1.35, 1.5, 1.7, 2]
const SCALE_KEY = 'workspace.epub.scale'
const POSITIONS_KEY = 'workspace.epub.positions'
const MAX_POSITIONS = 200
const MAX_MATCHES = 5000

/** Where the reader is: a section, and how far through it (0–1). */
interface Position {
  section: number
  fraction: number
}

interface SectionView {
  host: HTMLElement
  root: ShadowRoot | null
  rendering: Promise<void> | null
  media: Promise<void> | null
  /** A fixed-layout page's own size. */
  page: { width: number; height: number } | null
}

let styled = false

function addReaderStyles() {
  if (styled) return
  styled = true
  const style = document.createElement('style')
  style.dataset.epubReader = ''
  style.textContent = readerCss
  document.head.appendChild(style)
}

function el<K extends keyof HTMLElementTagNameMap>(tag: K, className?: string, text?: string) {
  const node = document.createElement(tag)
  if (className) node.className = className
  if (text) node.textContent = text
  return node
}

function loadPositions(): Record<string, Position & { at: number }> {
  try {
    const parsed: unknown = JSON.parse(localStorage.getItem(POSITIONS_KEY) || '{}')
    return typeof parsed === 'object' && parsed !== null ? (parsed as Record<string, Position & { at: number }>) : {}
  } catch {
    return {}
  }
}

function savePosition(key: string, position: Position) {
  const positions = loadPositions()
  positions[key] = { ...position, at: Date.now() }
  const keys = Object.keys(positions)
  if (keys.length > MAX_POSITIONS) {
    keys.sort((a, b) => positions[a].at - positions[b].at)
    for (const old of keys.slice(0, keys.length - MAX_POSITIONS)) delete positions[old]
  }
  localStorage.setItem(POSITIONS_KEY, JSON.stringify(positions))
}

const savedScale = () => {
  const scale = Number(localStorage.getItem(SCALE_KEY))
  return SCALES.includes(scale) ? scale : 1
}

/** An inline style without its url()s, which would load from the app or the web, not the book. */
const settle = (promise: Promise<unknown>, ms: number) => Promise.race([promise.catch(() => {}), new Promise((resolve) => setTimeout(resolve, ms))])

export async function mountReader(element: HTMLElement, context: PluginEditorContext): Promise<PluginEditor> {
  addReaderStyles()
  if (!context.bytes?.length) throw new Error('This book is empty.')
  const bytes = context.bytes
  const book = await openBook(bytes)
  const resources = new Resources(book)
  const styles = new Styles(book, resources)
  try {
    return await show(element, context, book, bytes, resources, styles)
  } catch (err) {
    styles.destroy()
    resources.destroy()
    throw err
  }
}

async function show(element: HTMLElement, context: PluginEditorContext, book: Book, bytes: Uint8Array, resources: Resources, styles: Styles): Promise<PluginEditor> {
  await styles.prepare()

  let theme: Theme = context.theme
  let scale = savedScale()
  let destroyed = false

  const reader = el('div', 'epub-reader')
  reader.dataset.theme = theme
  const scroller = el('div', 'epub-scroll')
  scroller.tabIndex = -1
  const column = el('div', `epub-column${book.fixedLayout ? ' fixed' : ''}`)
  column.style.setProperty('--epub-scale', String(scale))
  const status = el('div', 'epub-status')
  scroller.appendChild(column)
  reader.append(scroller, status)
  element.replaceChildren(reader)

  const sectionIndex = new Map(book.sections.map((s, i) => [s.path, i]))
  const views: SectionView[] = book.sections.map(() => {
    const host = el('section', 'epub-section')
    column.appendChild(host)
    return { host, root: null, rendering: null, media: null, page: null }
  })

  // ── Rendering

  function render(i: number): Promise<void> {
    const view = views[i]
    view.rendering ??= renderSection(i).catch((err) => {
      console.error(`EPUB: couldn't show ${book.sections[i].path}`, err)
    })
    return view.rendering
  }

  async function renderSection(i: number) {
    const section = book.sections[i]
    const view = views[i]
    const doc = parseMarkup(await readText(book.zip, section.path), section.mediaType)

    const css: Promise<string>[] = []
    for (const node of Array.from(doc.querySelectorAll('link, style'))) {
      if (node.localName === 'style') css.push(styles.inline(node.textContent ?? '', section.path))
      else if (/\bstylesheet\b/i.test(node.getAttribute('rel') ?? '') && node.getAttribute('href') && !/\balternate\b/i.test(node.getAttribute('rel') ?? '')) {
        const href = node.getAttribute('href')!
        if (!isExternal(href)) css.push(styles.sheet(resolvePath(section.path, href)))
      }
    }

    const html = doc.documentElement
    const body = doc.querySelector('body') ?? html
    const content = DOMPurify.sanitize(body, {
      RETURN_DOM_FRAGMENT: true,
      FORBID_TAGS: ['style', 'link', 'base', 'meta', 'form', 'input', 'button', 'select', 'textarea', 'iframe', 'object', 'embed'],
      FORBID_ATTR: ['target'],
    })
    prepareMedia(content, section.path)

    const htmlBox = el('div', 'epub-html')
    const bodyBox = el('div', 'epub-body')
    copyAttributes(html, htmlBox)
    if (body !== html) copyAttributes(body, bodyBox)
    bodyBox.appendChild(content)
    htmlBox.appendChild(bodyBox)

    if (book.fixedLayout) {
      const viewport = doc.querySelector('meta[name="viewport"]')?.getAttribute('content') ?? ''
      const width = Number(/width\s*=\s*(\d+)/.exec(viewport)?.[1])
      const height = Number(/height\s*=\s*(\d+)/.exec(viewport)?.[1])
      if (width && height) {
        view.page = { width, height }
        view.host.classList.add('fixed')
        htmlBox.style.width = `${width}px`
        htmlBox.style.height = `${height}px`
      }
    }

    const sheets = await Promise.all(css)
    if (destroyed) return
    const root = view.host.attachShadow({ mode: 'open' })
    const style = (text: string) => {
      const node = document.createElement('style')
      node.textContent = text
      return node
    }
    root.append(style(BASE_CSS), style(sheets.join('\n')), style(OVERRIDE_CSS), htmlBox)
    view.root = root
    view.host.dataset.theme = theme
    view.host.classList.add('rendered')
    if (view.page) fitPage(view)
    mediaObserver.observe(view.host)
    resizeObserver.observe(view.host)
    searchNewSection(i)
  }

  /** Keeps the attributes that matter for styling (class, lang, dir, style) when html and body become divs. */
  function copyAttributes(from: Element, to: HTMLElement) {
    to.classList.add(...(from.getAttribute('class') ?? '').split(/\s+/).filter(Boolean))
    for (const name of ['id', 'lang', 'dir', 'style']) {
      const value = from.getAttribute(name)
      if (value) to.setAttribute(name, name === 'style' ? withoutUrls(value) : value)
    }
    const lang = from.getAttribute('xml:lang') ?? from.getAttributeNS('http://www.w3.org/XML/1998/namespace', 'lang')
    if (lang && !to.lang) to.lang = lang
  }

  /**
   * Pictures load when their section comes near; until then they point nowhere. Nothing in a
   * book loads from the web.
   */
  function prepareMedia(root: DocumentFragment, base: string) {
    for (const node of Array.from(root.querySelectorAll('img[src], video[src], audio[src], source[src], video[poster], img[srcset], source[srcset]'))) {
      node.removeAttribute('srcset')
      for (const attr of ['src', 'poster']) {
        const value = node.getAttribute(attr)
        if (!value || value.startsWith('data:')) continue
        if (!isExternal(value)) node.setAttribute(`data-epub-${attr}`, resolvePath(base, value))
        node.removeAttribute(attr)
      }
    }
    for (const node of Array.from(root.querySelectorAll('image'))) {
      const value = node.getAttributeNS(XLINK, 'href') ?? node.getAttribute('href')
      if (!value || value.startsWith('data:')) continue
      if (!isExternal(value)) node.setAttribute('data-epub-href', resolvePath(base, value))
      node.removeAttributeNS(XLINK, 'href')
      node.removeAttribute('href')
    }
    // Every style attribute: an escaped `u\72l(` doesn't contain "url(".
    for (const node of Array.from(root.querySelectorAll<HTMLElement>('[style]'))) node.setAttribute('style', withoutUrls(node.getAttribute('style')!))
    for (const link of Array.from(root.querySelectorAll('a[href]'))) {
      const href = link.getAttribute('href')!
      if (!isExternal(href)) link.setAttribute('data-epub-link', resolveHref(base, href))
    }
  }

  function loadMedia(i: number): Promise<void> {
    const view = views[i]
    if (!view.root) return Promise.resolve()
    view.media ??= (async () => {
      const waits: Promise<unknown>[] = []
      for (const node of Array.from(view.root!.querySelectorAll('[data-epub-src], [data-epub-poster], [data-epub-href]'))) {
        for (const attr of ['src', 'poster', 'href']) {
          const path = node.getAttribute(`data-epub-${attr}`)
          if (!path) continue
          const url = await resources.url(path)
          if (!url || destroyed) continue
          if (attr === 'href') node.setAttributeNS(XLINK, 'href', url)
          else node.setAttribute(attr, url)
          if (node instanceof HTMLImageElement) waits.push(node.decode())
        }
      }
      await settle(Promise.all(waits), 3000)
    })()
    return view.media
  }

  // ── Fixed-layout pages

  function fitPage(view: SectionView) {
    if (!view.page || !view.root) return
    const room = column.clientWidth - 48
    const s = Math.min(room / view.page.width, (scroller.clientHeight - 48) / view.page.height)
    const box = view.root.querySelector<HTMLElement>('.epub-html')!
    box.style.transform = `scale(${s})`
    view.host.style.width = `${Math.floor(view.page.width * s)}px`
    view.host.style.height = `${Math.floor(view.page.height * s)}px`
  }

  // ── Keeping the reader's place
  //
  // Sections render and pictures load after the reader has scrolled somewhere, and Safari has
  // no scroll anchoring. The place is kept as (section, offset into it) and put back whenever a
  // section changes size.

  let anchor = { section: 0, offset: 0 }
  /** Where the reader last scrolled itself to; the scroll event that follows isn't the user. */
  let placed = -1

  function sectionAt(y: number): number {
    let lo = 0
    let hi = views.length - 1
    while (lo < hi) {
      const mid = (lo + hi + 1) >> 1
      if (views[mid].host.offsetTop <= y) lo = mid
      else hi = mid - 1
    }
    return lo
  }

  function updateAnchor() {
    const y = scroller.scrollTop
    const section = sectionAt(y)
    anchor = { section, offset: y - views[section].host.offsetTop }
  }

  function restoreAnchor() {
    const top = views[anchor.section].host.offsetTop + anchor.offset
    if (Math.abs(scroller.scrollTop - top) >= 1) {
      scroller.scrollTop = top
      placed = scroller.scrollTop
    }
  }

  const resizeObserver = new ResizeObserver(() => {
    if (destroyed) return
    restoreAnchor()
  })

  const scrollerObserver = new ResizeObserver(() => {
    if (destroyed || !book.fixedLayout) return
    for (const view of views) fitPage(view)
    restoreAnchor()
  })
  scrollerObserver.observe(scroller)

  const mediaObserver = new IntersectionObserver(
    (entries) => {
      for (const entry of entries) {
        if (!entry.isIntersecting) continue
        const i = views.findIndex((v) => v.host === entry.target)
        if (i >= 0) void loadMedia(i)
      }
    },
    { root: scroller, rootMargin: '150% 0px' },
  )

  function position(): Position {
    const height = views[anchor.section].host.offsetHeight
    return { section: anchor.section, fraction: height ? Math.min(1, Math.max(0, anchor.offset / height)) : 0 }
  }

  async function goTo(target: Position | { section: number; fragment: string }) {
    const { section } = target
    await render(section)
    await loadMedia(section)
    if (destroyed) return
    const view = views[section]
    // The start of a section shows a little room above it; the start of the book, all of it.
    let offset = section === 0 ? -view.host.offsetTop : -16
    if ('fraction' in target) offset = target.fraction ? target.fraction * view.host.offsetHeight : offset
    else if (target.fragment && view.root) {
      const id = safeDecode(target.fragment)
      const node = view.root.getElementById(id) ?? view.root.querySelector(`[name="${CSS.escape(id)}"]`)
      if (node) offset = node.getBoundingClientRect().top - view.host.getBoundingClientRect().top - 16
    }
    anchor = { section, offset }
    restoreAnchor()
    updateStatus()
  }

  function goToHref(href: string) {
    const [path, fragment = ''] = href.split('#')
    const section = sectionIndex.get(path)
    if (section !== undefined) void goTo({ section, fragment })
  }

  // ── Table of contents

  interface TocItem {
    entry: TocEntry
    depth: number
    section: number
    fragment: string
    button: HTMLButtonElement | null
  }

  const tocItems: TocItem[] = []
  const flatten = (entries: TocEntry[], depth: number) => {
    for (const entry of entries) {
      const [path, fragment = ''] = entry.href.split('#')
      const section = sectionIndex.get(path)
      if (section !== undefined) tocItems.push({ entry, depth, section, fragment, button: null })
      flatten(entry.children, depth + 1)
    }
  }
  flatten(book.toc, 0)

  if (context.sidebar) {
    const about = el('div', 'epub-book')
    about.appendChild(el('div', 'epub-book-title', book.title || context.title))
    if (book.author) about.appendChild(el('div', 'epub-book-author', book.author))
    const nav = el('nav', 'list epub-toc')
    nav.setAttribute('aria-label', 'Contents')
    for (const item of tocItems) {
      const button = el('button', 'list-item outline-item')
      button.type = 'button'
      button.style.paddingLeft = `${8 + item.depth * 14}px`
      const label = el('span', 'label', item.entry.label)
      if (item.depth === 0) label.style.fontWeight = '550'
      button.title = item.entry.label
      button.appendChild(label)
      button.addEventListener('click', () => void goTo({ section: item.section, fragment: item.fragment }))
      nav.appendChild(button)
      item.button = button
    }
    if (!tocItems.length) nav.appendChild(el('div', 'empty-hint', 'This book has no table of contents.'))
    context.sidebar.replaceChildren(about, nav)
  }

  /** Scrolls the sidebar to show `node`. (scrollIntoView would also scroll the app's own panes.) */
  function reveal(node: HTMLElement) {
    let pane = node.parentElement
    while (pane && !(pane.scrollHeight > pane.clientHeight && /auto|scroll/.test(getComputedStyle(pane).overflowY))) pane = pane.parentElement
    if (!pane) return
    const box = pane.getBoundingClientRect()
    const rect = node.getBoundingClientRect()
    if (rect.top < box.top) pane.scrollTop += rect.top - box.top - 8
    else if (rect.bottom > box.bottom) pane.scrollTop += rect.bottom - box.bottom + 8
  }

  /** The table of contents entry the reader is in. */
  function currentItem(): TocItem | null {
    // At the very end, the last entry, even if it's too short to reach the top of the view.
    if (scroller.scrollTop > 0 && scroller.scrollTop >= scroller.scrollHeight - scroller.clientHeight - 2) return tocItems[tocItems.length - 1] ?? null
    const { section, offset } = anchor
    // An entry counts as reached once it's in the top third of the view.
    const reach = offset + scroller.clientHeight / 3
    let current: TocItem | null = null
    for (const item of tocItems) {
      if (item.section > section) break
      if (item.section === section && item.fragment) {
        const view = views[section]
        const node = view.root?.getElementById(safeDecode(item.fragment))
        if (node && node.getBoundingClientRect().top - view.host.getBoundingClientRect().top > reach) continue
      }
      current = item
    }
    return current
  }

  let activeItem: TocItem | null = null
  function updateStatus() {
    const item = currentItem()
    if (item !== activeItem) {
      activeItem?.button?.classList.remove('active')
      item?.button?.classList.add('active')
      if (item?.button) reveal(item.button)
      activeItem = item
    }
    const max = scroller.scrollHeight - scroller.clientHeight
    const percent = max > 0 ? Math.round((scroller.scrollTop / max) * 100) : 0
    const where = item?.entry.label || book.title
    status.textContent = where ? `${where} · ${percent}%` : `${percent}%`
  }

  // ── Scrolling

  let frame = 0
  let saveTimer = 0
  const save = () => {
    saveTimer = 0
    savePosition(book.key, position())
  }
  scroller.addEventListener(
    'scroll',
    () => {
      if (Math.abs(scroller.scrollTop - placed) < 1) placed = -1
      else updateAnchor()
      if (frame) return
      frame = requestAnimationFrame(() => {
        frame = 0
        updateStatus()
      })
      clearTimeout(saveTimer)
      saveTimer = window.setTimeout(save, 400)
    },
    { passive: true },
  )

  scroller.addEventListener('click', (event) => {
    const link = event
      .composedPath()
      .find((node): node is Element => node instanceof Element && node.localName === 'a' && (node.hasAttribute('href') || node.hasAttribute('data-epub-link')))
    if (!link) return
    event.preventDefault()
    const internal = link.getAttribute('data-epub-link')
    if (internal) goToHref(internal)
    else {
      const href = link.getAttribute('href') ?? ''
      if (/^(https?:|mailto:)/i.test(href)) context.openExternal(href)
    }
  })

  // ── Find

  let query = ''
  let marks: HTMLElement[] = []
  let current = -1

  function clearMarks() {
    const parents = new Set<Node>()
    for (const mark of marks) {
      const parent = mark.parentNode
      if (!parent) continue
      parent.replaceChild(document.createTextNode(mark.textContent ?? ''), mark)
      parents.add(parent)
    }
    for (const parent of parents) parent.normalize()
    marks = []
    current = -1
  }

  /** Which section each mark is in, to keep marks in reading order as sections arrive. */
  const markSections = new WeakMap<HTMLElement, number>()

  function markMatches(text: string) {
    for (let i = 0; i < views.length && marks.length < MAX_MATCHES; i++) marks.push(...markSection(i, text, MAX_MATCHES - marks.length))
  }

  function markSection(i: number, text: string, limit: number): HTMLElement[] {
    const root = views[i].root
    const found: HTMLElement[] = []
    if (!root || limit <= 0) return found
    const needle = text.toLocaleLowerCase()
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT)
    const nodes: Text[] = []
    while (walker.nextNode()) {
      const node = walker.currentNode as Text
      if (node.parentElement?.closest('style')) continue
      if (node.data.toLocaleLowerCase().includes(needle)) nodes.push(node)
    }
    for (const node of nodes) {
      const haystack = node.data.toLocaleLowerCase()
      const starts: number[] = []
      for (let at = haystack.indexOf(needle); at >= 0; at = haystack.indexOf(needle, at + needle.length)) starts.push(at)
      // Split from the end so earlier offsets stay right.
      const inNode: HTMLElement[] = []
      for (const start of starts.reverse()) {
        const match = node.splitText(start)
        match.splitText(needle.length)
        const mark = document.createElement('mark')
        mark.className = 'epub-find'
        match.parentNode!.replaceChild(mark, match)
        mark.appendChild(match)
        markSections.set(mark, i)
        inNode.unshift(mark)
      }
      found.push(...inNode)
      if (found.length >= limit) break
    }
    return found
  }

  /** A section rendered while a search was open: adds its matches and tells the find bar. */
  function searchNewSection(i: number) {
    if (!query || marks.length >= MAX_MATCHES) return
    const found = markSection(i, query, MAX_MATCHES - marks.length)
    if (!found.length) return
    let at = marks.findIndex((mark) => markSections.get(mark)! > i)
    if (at < 0) at = marks.length
    marks.splice(at, 0, ...found)
    if (current >= at) current += found.length
    context.searchChanged?.({ count: marks.length, current })
  }

  function select(index: number) {
    marks[current]?.classList.remove('current')
    current = index
    const mark = marks[current]
    if (!mark) return
    mark.classList.add('current')
    const rect = mark.getBoundingClientRect()
    const view = scroller.getBoundingClientRect()
    if (rect.top < view.top + 40 || rect.bottom > view.bottom - 40) {
      scroller.scrollTop += rect.top - view.top - scroller.clientHeight / 3
    }
  }

  function search(text: string, step: 1 | -1 | 0): SearchResult {
    if (text !== query || step === 0) {
      clearMarks()
      query = text
      if (!text) return { count: 0, current: -1 }
      markMatches(text)
      // Start from the first match below the top of the view.
      const top = scroller.getBoundingClientRect().top
      const first = marks.findIndex((mark) => mark.getBoundingClientRect().bottom >= top)
      if (marks.length) select(first >= 0 ? first : 0)
    } else if (marks.length) {
      select((current + step + marks.length) % marks.length)
    }
    return { count: marks.length, current }
  }

  // ── Opening

  const saved = loadPositions()[book.key]
  const start: Position = saved && saved.section < views.length ? { section: saved.section, fraction: saved.fraction } : { section: 0, fraction: 0 }
  // The section the reader opens at, and the next, before anything else; the rest follow.
  await render(start.section)
  if (start.section + 1 < views.length) await render(start.section + 1)
  await goTo(start)
  void (async () => {
    for (let i = 0; i < views.length && !destroyed; i++) {
      if (views[i].rendering) continue
      await render(i)
      // Let the reader scroll between sections.
      await new Promise((resolve) => setTimeout(resolve, 0))
    }
    if (!destroyed) updateStatus()
  })()

  scroller.focus({ preventScroll: true })

  function setScale(next: number) {
    if (next === scale) return
    const place = position()
    scale = next
    column.style.setProperty('--epub-scale', String(scale))
    localStorage.setItem(SCALE_KEY, String(scale))
    anchor = { section: place.section, offset: place.fraction * views[place.section].host.offsetHeight }
    restoreAnchor()
  }

  return {
    async getBytes() {
      return bytes
    },
    setTheme(next) {
      theme = next
      reader.dataset.theme = theme
      for (const view of views) view.host.dataset.theme = theme
    },
    setActive(active) {
      if (active) scroller.focus({ preventScroll: true })
    },
    search,
    zoom(direction) {
      const at = SCALES.indexOf(scale)
      if (direction === 'reset') setScale(1)
      else setScale(SCALES[Math.min(SCALES.length - 1, Math.max(0, at + (direction === 'in' ? 1 : -1)))])
    },
    async print() {
      for (let i = 0; i < views.length; i++) {
        await render(i)
        await loadMedia(i)
      }
      const page = el('div', 'epub-print')
      for (const view of views) {
        if (!view.root) continue
        const host = el('section', 'epub-section')
        host.dataset.theme = 'light'
        const root = host.attachShadow({ mode: 'open' })
        for (const child of Array.from(view.root.children)) root.appendChild(child.cloneNode(true))
        root.querySelector<HTMLElement>('.epub-html')?.style.removeProperty('transform')
        for (const mark of Array.from(root.querySelectorAll('mark.epub-find'))) mark.replaceWith(...Array.from(mark.childNodes))
        page.appendChild(host)
      }
      await context.print(page)
    },
    destroy() {
      if (saveTimer) {
        clearTimeout(saveTimer)
        save()
      }
      destroyed = true
      cancelAnimationFrame(frame)
      resizeObserver.disconnect()
      scrollerObserver.disconnect()
      mediaObserver.disconnect()
      styles.destroy()
      resources.destroy()
      element.replaceChildren()
      context.sidebar?.replaceChildren()
    },
  }
}

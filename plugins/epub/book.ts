// Reads an EPUB (2 or 3): the zip, its package document (metadata, manifest, reading order)
// and its table of contents. Paths are zip paths, without a leading slash.

import JSZip from 'jszip'

export interface TocEntry {
  label: string
  /** Zip path of the section, with its #fragment if it has one. */
  href: string
  children: TocEntry[]
}

export interface Section {
  path: string
  mediaType: string
}

export interface Book {
  zip: JSZip
  title: string
  author: string
  /** dc:identifier, or a stand-in when the book has none. Keys the saved reading position. */
  key: string
  /** Fixed-layout books (comics, picture books): each section is a page of a set size. */
  fixedLayout: boolean
  sections: Section[]
  toc: TocEntry[]
  mediaTypes: Map<string, string>
}

const OPS = 'http://www.idpf.org/2007/ops'
/** Font obfuscation (IDPF's and Adobe's): common in books without DRM. */
const FONT_OBFUSCATION = ['http://www.idpf.org/2008/embedding', 'http://ns.adobe.com/pdf/enc#RC']

/** decodeURIComponent that leaves text with a malformed escape (`100%.xhtml`) as it is. */
export function safeDecode(text: string): string {
  try {
    return decodeURIComponent(text)
  } catch {
    return text
  }
}

/** Resolves `href` against the zip path `base`, dropping any fragment. */
export function resolvePath(base: string, href: string): string {
  const url = new URL(href, `https://book.invalid/${base}`)
  return safeDecode(url.pathname.slice(1))
}

/** `href` resolved against `base`, keeping its fragment: `OEBPS/ch1.xhtml#note-3`. */
export function resolveHref(base: string, href: string): string {
  const url = new URL(href, `https://book.invalid/${base}`)
  return safeDecode(url.pathname.slice(1)) + url.hash
}

/** Whether a link leaves the book (https:, mailto:…). */
export const isExternal = (href: string) => /^[a-z][a-z0-9+.-]*:/i.test(href)

const byTag = (root: Document | Element, name: string) => Array.from(root.getElementsByTagNameNS('*', name))
const text = (el: Element | undefined) => el?.textContent?.replace(/\s+/g, ' ').trim() ?? ''

export function parseXml(source: string, type: DOMParserSupportedType = 'application/xml'): Document {
  return new DOMParser().parseFromString(source, type)
}

/** Parses a section's markup. Many books aren't well-formed XML (an undeclared &nbsp;), so fall back to HTML. */
export function parseMarkup(source: string, mediaType: string): Document {
  if (mediaType !== 'text/html') {
    const doc = parseXml(source, 'application/xhtml+xml')
    if (!doc.getElementsByTagName('parsererror').length) return doc
  }
  return parseXml(source, 'text/html')
}

export async function readText(zip: JSZip, path: string): Promise<string> {
  const file = zip.file(path)
  if (!file) throw new Error(`The book is missing ${path}.`)
  return file.async('string')
}

export async function openBook(bytes: Uint8Array): Promise<Book> {
  let zip: JSZip
  try {
    zip = await JSZip.loadAsync(bytes)
  } catch {
    throw new Error('This file isn’t an EPUB book (it isn’t a zip archive).')
  }

  const encryption = zip.file('META-INF/encryption.xml')
  if (encryption) {
    const methods = byTag(parseXml(await encryption.async('string')), 'EncryptionMethod').map((m) => m.getAttribute('Algorithm') ?? '')
    if (methods.some((m) => !FONT_OBFUSCATION.includes(m))) throw new Error('This book is protected with DRM, so Workspace can’t open it.')
  }

  const container = parseXml(await readText(zip, 'META-INF/container.xml'))
  const rootfile = byTag(container, 'rootfile').find((el) => (el.getAttribute('media-type') ?? 'application/oebps-package+xml') === 'application/oebps-package+xml')
  const opfPath = rootfile?.getAttribute('full-path')
  if (!opfPath) throw new Error('This EPUB doesn’t say where its contents are.')
  const opf = parseXml(await readText(zip, opfPath))

  const manifest = new Map<string, { path: string; mediaType: string; properties: string[] }>()
  const mediaTypes = new Map<string, string>()
  for (const item of byTag(opf, 'item')) {
    const id = item.getAttribute('id')
    const href = item.getAttribute('href')
    if (!id || !href) continue
    const path = resolvePath(opfPath, href)
    const mediaType = item.getAttribute('media-type') ?? ''
    manifest.set(id, { path, mediaType, properties: (item.getAttribute('properties') ?? '').split(/\s+/) })
    mediaTypes.set(path, mediaType)
  }

  const spine = byTag(opf, 'spine')[0]
  const sections: Section[] = []
  for (const ref of byTag(opf, 'itemref')) {
    const item = manifest.get(ref.getAttribute('idref') ?? '')
    if (item && /html|xml/.test(item.mediaType) && zip.file(item.path)) sections.push({ path: item.path, mediaType: item.mediaType })
  }
  if (!sections.length) throw new Error('This EPUB has no readable sections.')

  const metadata = byTag(opf, 'metadata')[0] ?? opf.documentElement
  const meta = (property: string) => byTag(metadata, 'meta').find((m) => m.getAttribute('property') === property || m.getAttribute('name') === property)
  const layout = meta('rendition:layout')
  const fixedLayout = (layout?.textContent?.trim() || layout?.getAttribute('content')) === 'pre-paginated'

  const title = text(byTag(metadata, 'title')[0])
  const author = byTag(metadata, 'creator').map(text).filter(Boolean).join(', ')
  const identifier = text(byTag(metadata, 'identifier')[0])

  let toc: TocEntry[] = []
  const nav = [...manifest.values()].find((item) => item.properties.includes('nav'))
  try {
    if (nav) toc = await readNav(zip, nav.path)
    if (!toc.length) {
      const ncx = manifest.get(spine?.getAttribute('toc') ?? '') ?? [...manifest.values()].find((item) => item.mediaType === 'application/x-dtbncx+xml')
      if (ncx) toc = await readNcx(zip, ncx.path)
    }
  } catch {
    // A broken table of contents shouldn't stop the book opening.
    toc = []
  }

  return {
    zip,
    title,
    author,
    key: identifier || `${title}:${bytes.length}`,
    fixedLayout,
    sections,
    toc,
    mediaTypes,
  }
}

/** EPUB 3: the <nav epub:type="toc"> of the navigation document. */
async function readNav(zip: JSZip, path: string): Promise<TocEntry[]> {
  const doc = parseMarkup(await readText(zip, path), 'application/xhtml+xml')
  const navs = byTag(doc, 'nav')
  const type = (el: Element) => el.getAttributeNS(OPS, 'type') ?? el.getAttribute('epub:type') ?? ''
  const nav = navs.find((el) => type(el).split(/\s+/).includes('toc')) ?? navs[0]
  const list = nav && Array.from(nav.children).find((el) => el.localName === 'ol')
  return list ? navList(list, path) : []
}

function navList(list: Element, base: string): TocEntry[] {
  const entries: TocEntry[] = []
  for (const li of Array.from(list.children)) {
    if (li.localName !== 'li') continue
    const label = Array.from(li.children).find((el) => el.localName === 'a' || el.localName === 'span')
    const sublist = Array.from(li.children).find((el) => el.localName === 'ol')
    const href = label?.getAttribute('href')
    const children = sublist ? navList(sublist, base) : []
    if (href && !isExternal(href)) entries.push({ label: text(label) || 'Untitled', href: resolveHref(base, href), children })
    // A heading without a link of its own: its first child stands in.
    else if (children.length) entries.push({ label: text(label) || children[0].label, href: children[0].href, children })
  }
  return entries
}

/** EPUB 2: the NCX file's navMap. */
async function readNcx(zip: JSZip, path: string): Promise<TocEntry[]> {
  const doc = parseXml(await readText(zip, path))
  const map = byTag(doc, 'navMap')[0]
  return map ? ncxPoints(map, path) : []
}

function ncxPoints(parent: Element, base: string): TocEntry[] {
  return Array.from(parent.children)
    .filter((el) => el.localName === 'navPoint')
    .flatMap((point) => {
      const src = byTag(point, 'content')[0]?.getAttribute('src')
      if (!src) return []
      const label = text(byTag(point, 'navLabel')[0])
      return [{ label: label || 'Untitled', href: resolveHref(base, src), children: ncxPoints(point, base) }]
    })
}

// A book's stylesheets and the files they and its pages point at.
//
// Each section renders in its own shadow root, so a book's CSS can't reach the app. Three things
// don't carry over by themselves: `html` and `body` selectors (a section's html and body are
// divs), url()s relative to the book (they become blob: URLs of files in the zip), and
// @font-face, which Chromium ignores inside shadow roots. Font faces go into one document-level
// stylesheet instead, under family names private to this book.

import type { Book } from './book'
import { isExternal, readText, resolvePath } from './book'

let books = 0

export class Resources {
  private urls = new Map<string, Promise<string | null>>()
  constructor(private book: Book) {}

  /** A blob: URL for a file in the zip; null if the book doesn't have it. */
  url(path: string): Promise<string | null> {
    let url = this.urls.get(path)
    if (!url) {
      const file = this.book.zip.file(path)
      url = file
        ? file.async('blob').then((blob) => URL.createObjectURL(new Blob([blob], { type: this.book.mediaTypes.get(path) || guessType(path) })))
        : Promise.resolve(null)
      this.urls.set(path, url)
    }
    return url
  }

  destroy() {
    for (const url of this.urls.values()) void url.then((u) => u && URL.revokeObjectURL(u))
    this.urls.clear()
  }
}

function guessType(path: string) {
  const ext = path.split('.').pop()?.toLowerCase() ?? ''
  const types: Record<string, string> = {
    jpg: 'image/jpeg',
    jpeg: 'image/jpeg',
    png: 'image/png',
    gif: 'image/gif',
    svg: 'image/svg+xml',
    webp: 'image/webp',
    otf: 'font/otf',
    ttf: 'font/ttf',
    woff: 'font/woff',
    woff2: 'font/woff2',
  }
  return types[ext] ?? 'application/octet-stream'
}

const URL_RE = /url\(\s*(['"]?)([^'")]+?)\1\s*\)/gi
const IMPORT_RE = /@import\s+(?:url\(\s*)?(['"]?)([^'")\s;]+)\1\s*\)?[^;]*;/gi
const FONT_FACE_RE = /@font-face\s*\{[^}]*\}/gi
const FAMILY_RE = /font-family\s*:\s*(['"]?)([^;'"}]+?)\1\s*(?=;|\}|$)/i

export class Styles {
  /** Book font family (lower case) → its private name. */
  private families = new Map<string, string>()
  private faces = new Set<string>()
  private sheets = new Map<string, Promise<string>>()
  private fonts: HTMLStyleElement
  private prefix = `epub${++books}-`

  constructor(
    private book: Book,
    private resources: Resources,
  ) {
    this.fonts = document.createElement('style')
    this.fonts.dataset.epubFonts = ''
    document.head.appendChild(this.fonts)
  }

  /**
   * Reads every stylesheet the book lists, so each font face is known before any page uses
   * it (books often declare fonts in one file and use them in another).
   */
  async prepare() {
    const paths = [...this.book.mediaTypes].filter(([, type]) => type === 'text/css').map(([path]) => path)
    const raw = await Promise.all(paths.map((path) => this.flatten(path, new Set()).catch(() => '')))
    const rest = raw.map((css) => this.takeFontFaces(css))
    paths.forEach((path, i) => this.sheets.set(path, Promise.resolve(this.finish(rest[i]))))
  }

  /** A linked stylesheet, ready for a section's shadow root. */
  sheet(path: string): Promise<string> {
    let sheet = this.sheets.get(path)
    if (!sheet) {
      // Not in the manifest, but the page links it.
      sheet = this.flatten(path, new Set())
        .then((css) => this.finish(this.takeFontFaces(css)))
        .catch(() => '')
      this.sheets.set(path, sheet)
    }
    return sheet
  }

  /** A section's own <style>. */
  async inline(css: string, base: string): Promise<string> {
    return this.finish(this.takeFontFaces(await this.rewrite(css, base, new Set())))
  }

  destroy() {
    this.fonts.remove()
  }

  /** The stylesheet at `path` with its @imports inlined and url()s pointing into the zip. */
  private async flatten(path: string, seen: Set<string>): Promise<string> {
    if (seen.has(path)) return ''
    seen.add(path)
    return this.rewrite(await readText(this.book.zip, path), path, seen)
  }

  private async rewrite(css: string, base: string, seen: Set<string>): Promise<string> {
    css = css.replace(/\/\*[\s\S]*?\*\//g, '').replace(/@(charset|namespace)[^;]*;/gi, '')

    const imports = new Map<string, string>()
    for (const [, , href] of css.matchAll(IMPORT_RE)) {
      if (!isExternal(href) && !imports.has(href)) imports.set(href, await this.flatten(resolvePath(base, href), seen).catch(() => ''))
    }
    css = css.replace(IMPORT_RE, (_, _q, href: string) => imports.get(href) ?? '')

    const urls = new Map<string, string | null>()
    for (const [, , ref] of css.matchAll(URL_RE)) {
      if (urls.has(ref) || ref.startsWith('#') || ref.startsWith('data:')) continue
      urls.set(ref, isExternal(ref) ? null : await this.resources.url(resolvePath(base, ref)))
    }
    // Nothing loads from the web (a web font, say), and a file the book lacks would be fetched
    // from the app, so both go.
    return css.replace(URL_RE, (match, _q, ref: string) => {
      const url = urls.get(ref)
      return url ? `url("${url}")` : url === null ? 'none' : match
    })
  }

  /** Moves @font-face rules to the document, renaming their families; returns the rest. */
  private takeFontFaces(css: string): string {
    const faces: string[] = []
    const rest = css.replace(FONT_FACE_RE, (face) => {
      const family = FAMILY_RE.exec(face)?.[2]?.trim()
      if (!family) return ''
      let scoped = this.families.get(family.toLowerCase())
      if (!scoped) {
        scoped = this.prefix + family.replace(/[^\w-]/g, '_')
        this.families.set(family.toLowerCase(), scoped)
      }
      const renamed = face.replace(FAMILY_RE, `font-family: "${scoped}"`)
      // A sheet imported by another is read twice.
      if (!this.faces.has(renamed)) faces.push(renamed)
      this.faces.add(renamed)
      return ''
    })
    if (faces.length) this.fonts.textContent += faces.join('\n') + '\n'
    return rest
  }

  /** Scopes selectors to the section and points font families at the renamed faces. */
  private finish(css: string): string {
    if (this.families.size) {
      css = css.replace(/(font(?:-family)?\s*:)([^;}]*)/gi, (_, property: string, value: string) => {
        const renamed = value.replace(/(['"]?)([^,'"]+?)\1(?=\s*(?:,|$|!))/g, (name, _q, family: string) => {
          const scoped = this.families.get(family.trim().toLowerCase())
          return scoped ? `"${scoped}"` : name
        })
        return property + renamed
      })
    }
    return css.replace(/([^{}]+)\{/g, (match, prelude: string) => {
      // At-rule preludes (@media …) stay; anything before a stray ";" isn't part of the selector.
      const selector = prelude.slice(prelude.lastIndexOf(';') + 1)
      if (selector.trim().startsWith('@')) return match
      return prelude.slice(0, prelude.length - selector.length) + scopeSelector(selector) + '{'
    })
  }
}

function scopeSelector(selector: string): string {
  return selector
    .replace(/(^|[\s,>+~(])(html|:root)(?=$|[\s.#:[>+~),])/gi, '$1.epub-html')
    .replace(/(^|[\s,>+~(])body(?=$|[\s.#:[>+~),])/gi, '$1.epub-body')
}

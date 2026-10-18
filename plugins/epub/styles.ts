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
  private destroyed = false
  constructor(private book: Book) {}

  /** A blob: URL for a file in the zip; null if the book doesn't have it or was closed. */
  url(path: string): Promise<string | null> {
    if (this.destroyed) return Promise.resolve(null)
    let url = this.urls.get(path)
    if (!url) {
      const file = this.book.zip.file(path)
      url = file
        ? file.async('blob').then((blob) =>
            // A render still running when the book closed mustn't leave a URL nobody revokes.
            this.destroyed ? null : URL.createObjectURL(new Blob([blob], { type: this.book.mediaTypes.get(path) || guessType(path) })),
          )
        : Promise.resolve(null)
      this.urls.set(path, url)
    }
    return url
  }

  destroy() {
    this.destroyed = true
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

const URL_RE = /url\(\s*(?:"([^"]*)"|'([^']*)'|([^'"()\s]*))\s*\)/gi
const IMAGE_SET_RE = /((?:-webkit-)?image-set\()((?:[^()]|\([^()]*\))*)\)/gi
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
    css = unescapeCss(css.replace(/\/\*[\s\S]*?\*\//g, '')).replace(/@(charset|namespace)[^;]*;/gi, '')

    const imports = new Map<string, string>()
    for (const [, , href] of css.matchAll(IMPORT_RE)) {
      if (!isExternal(href) && !imports.has(href)) imports.set(href, await this.flatten(resolvePath(base, href), seen).catch(() => ''))
    }
    css = css.replace(IMPORT_RE, (_, _q, href: string) => imports.get(href) ?? '')
    css = bareImageSetUrls(css)

    const urls = new Map<string, string | null>()
    for (const match of css.matchAll(URL_RE)) {
      const ref = urlOf(match)
      if (urls.has(ref) || ref.startsWith('#') || ref.startsWith('data:')) continue
      urls.set(ref, isExternal(ref) ? null : await this.resources.url(resolvePath(base, ref)))
    }
    // Nothing loads from the web (a web font, say), and a file the book lacks would be fetched
    // from the app, so both go.
    css = css.replace(URL_RE, (match, ...groups: (string | undefined)[]) => {
      const url = urls.get(groups[0] ?? groups[1] ?? groups[2] ?? '')
      return url ? `url("${url}")` : url === null ? 'none' : match
    })
    return invalidateLeftoverUrls(css)
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

const urlOf = (match: RegExpMatchArray) => match[1] ?? match[2] ?? match[3] ?? ''

/**
 * Decodes CSS escapes that stand for letters or "-" outside strings, so `u\72l(` or
 * `\69mage-set(` can't hide from the patterns here. Other escapes stay as they are.
 */
function unescapeCss(css: string): string {
  let out = ''
  let quote = ''
  for (let i = 0; i < css.length; i++) {
    const c = css[i]
    if (c === '\\' && !quote) {
      const hex = /^([0-9a-f]{1,6})[ \t\n\r\f]?/i.exec(css.slice(i + 1, i + 9))
      const char = hex ? String.fromCodePoint(Math.min(parseInt(hex[1], 16), 0x10ffff)) : css[i + 1]
      if (char && /^[a-z-]$/i.test(char)) {
        out += char
        i += hex ? hex[0].length : 1
        continue
      }
    }
    if (c === '\\') {
      // Copy the escape whole, so an escaped quote doesn't end a string.
      out += c + (css[i + 1] ?? '')
      i++
      continue
    }
    if (quote ? c === quote : c === '"' || c === "'") quote = quote ? '' : c
    out += c
  }
  return out
}

/** image-set("a.png" 1x) takes plain strings as URLs; makes them url()s the rest can see. */
const bareImageSetUrls = (css: string) =>
  css.replace(IMAGE_SET_RE, (_, head: string, args: string) => head + args.replace(/(^|[\s,])("[^"]*"|'[^']*')/g, '$1url($2)') + ')')

/** Any url() still not pointing into the zip (one the patterns couldn't read) stops being a URL. */
const invalidateLeftoverUrls = (css: string) => css.replace(/url\((?!\s*["']?(?:blob:|data:|#))/gi, 'invalid-url(')

/** A style attribute without anything that could load a file. */
export function withoutUrls(style: string): string {
  const css = bareImageSetUrls(unescapeCss(style.replace(/\/\*[\s\S]*?\*\//g, '')))
  return invalidateLeftoverUrls(css.replace(URL_RE, (match, ...groups: (string | undefined)[]) => ((groups[0] ?? groups[1] ?? groups[2] ?? '').startsWith('data:') ? match : 'none')))
}

function scopeSelector(selector: string): string {
  return selector
    .replace(/(^|[\s,>+~(])(html|:root)(?=$|[\s.#:[>+~),])/gi, '$1.epub-html')
    .replace(/(^|[\s,>+~(])body(?=$|[\s.#:[>+~),])/gi, '$1.epub-body')
}

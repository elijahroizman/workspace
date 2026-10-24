import { ChangeSet } from '@codemirror/state'

// Text files are saved in the encoding they were opened in: UTF-8 (with its byte-order mark if it
// had one), UTF-16 with a byte-order mark, or Windows-1252 for bytes that aren't UTF-8 (older
// Windows files, Latin-1). Decoding as UTF-8 regardless turned every such character into � and
// saving wrote the � back. Windows-1252 maps all 256 bytes, so even binary bytes round-trip.

export type TextEncoding = 'utf-8' | 'utf-8-bom' | 'utf-16le' | 'utf-16be' | 'windows-1252'

export function decodeText(bytes: Uint8Array): { text: string; encoding: TextEncoding } {
  const b = bytes
  if (b[0] === 0xef && b[1] === 0xbb && b[2] === 0xbf) return { text: new TextDecoder('utf-8', { ignoreBOM: true }).decode(b.subarray(3)), encoding: 'utf-8-bom' }
  if (b[0] === 0xff && b[1] === 0xfe) return { text: new TextDecoder('utf-16le', { ignoreBOM: true }).decode(b.subarray(2)), encoding: 'utf-16le' }
  if (b[0] === 0xfe && b[1] === 0xff) return { text: new TextDecoder('utf-16be', { ignoreBOM: true }).decode(b.subarray(2)), encoding: 'utf-16be' }
  try {
    return { text: new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(b), encoding: 'utf-8' }
  } catch {
    return { text: new TextDecoder('windows-1252').decode(b), encoding: 'windows-1252' }
  }
}

let cp1252: Map<number, number> | null = null

/**
 * The text in `encoding`. Windows-1252 text with a character it has no byte for (an emoji typed
 * in) is saved as UTF-8 instead, so nothing typed is lost; `encoding` says which was used.
 */
export function encodeText(text: string, encoding: TextEncoding): { bytes: Uint8Array; encoding: TextEncoding } {
  switch (encoding) {
    case 'utf-8':
      return { bytes: new TextEncoder().encode(text), encoding }
    case 'utf-8-bom': {
      const body = new TextEncoder().encode(text)
      const bytes = new Uint8Array(body.length + 3)
      bytes.set([0xef, 0xbb, 0xbf])
      bytes.set(body, 3)
      return { bytes, encoding }
    }
    case 'utf-16le':
    case 'utf-16be': {
      const bytes = new Uint8Array(2 + text.length * 2)
      const view = new DataView(bytes.buffer)
      const le = encoding === 'utf-16le'
      view.setUint16(0, 0xfeff, le)
      for (let i = 0; i < text.length; i++) view.setUint16(2 + i * 2, text.charCodeAt(i), le)
      return { bytes, encoding }
    }
    case 'windows-1252': {
      if (!cp1252) {
        const all = new TextDecoder('windows-1252').decode(Uint8Array.from({ length: 256 }, (_, i) => i))
        cp1252 = new Map([...all].map((c, i) => [c.charCodeAt(0), i]))
      }
      const bytes = new Uint8Array(text.length)
      for (let i = 0; i < text.length; i++) {
        const byte = cp1252.get(text.charCodeAt(i))
        if (byte === undefined) return encodeText(text, 'utf-8')
        bytes[i] = byte
      }
      return { bytes, encoding }
    }
  }
}

/** Keep untouched line endings when CodeMirror normalizes CRLF and CR to LF. */
export class TextFile {
  revision = 0
  readonly text: string
  private readonly raw: string
  private readonly original: Uint8Array | null
  private readonly encoding: TextEncoding
  private readonly crlf: number[] = []
  private readonly lineEnding: string
  private changes: ChangeSet

  constructor(bytes: Uint8Array | null, fallback = '') {
    this.original = bytes
    const decoded = bytes ? decodeText(bytes) : { text: fallback, encoding: 'utf-8' as const }
    this.raw = decoded.text
    this.encoding = decoded.encoding
    let extra = 0
    this.text = this.raw.replace(/\r\n?|\n/g, (ending, offset: number) => {
      if (ending === '\r\n') {
        this.crlf.push(offset - extra)
        extra++
      }
      return '\n'
    })
    this.lineEnding = /\r\n?|\n/.exec(this.raw)?.[0] ?? '\n'
    this.changes = ChangeSet.empty(this.text.length)
  }

  update(changes: ChangeSet) {
    this.changes = this.changes.compose(changes)
    this.revision++
  }

  private rawOffset(pos: number) {
    let lo = 0, hi = this.crlf.length
    while (lo < hi) {
      const mid = (lo + hi) >>> 1
      if (this.crlf[mid] < pos) lo = mid + 1
      else hi = mid
    }
    return pos + lo
  }

  getBytes() {
    const parts: string[] = []
    let pos = 0
    this.changes.iterChanges((from, to, _fromB, _toB, inserted) => {
      parts.push(this.raw.slice(this.rawOffset(pos), this.rawOffset(from)))
      const text = inserted.toString()
      // Undo and replacements that restore the original text restore its line endings too.
      parts.push(text === this.text.slice(from, to)
        ? this.raw.slice(this.rawOffset(from), this.rawOffset(to))
        : text.replace(/\n/g, this.lineEnding))
      pos = to
    }, true)
    parts.push(this.raw.slice(this.rawOffset(pos)))
    const text = parts.join('')
    // Decoders replace malformed sequences. A clean revision must still keep the exact input.
    if (text === this.raw && this.original) return this.original
    return encodeText(text, this.encoding).bytes
  }
}

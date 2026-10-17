// Word comments, read from and written into the .docx package.
//
// The editing engine keeps the comment markers of a file through edits and writes them back on
// save, but adding, answering or resolving a comment needs its paid review module. So Workspace
// keeps the threads itself: it reads them from the file, follows each one's text by paragraph and
// offset while the document changes, and writes the markers and comment parts into the saved file.

const W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main'
const W14 = 'http://schemas.microsoft.com/office/word/2010/wordml'
const W15 = 'http://schemas.microsoft.com/office/word/2012/wordml'
const MC = 'http://schemas.openxmlformats.org/markup-compatibility/2006'
const REL = 'http://schemas.openxmlformats.org/package/2006/relationships'
const CT = 'http://schemas.openxmlformats.org/package/2006/content-types'

const COMMENTS_TYPE = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships/comments'
const COMMENTS_EX_TYPE = 'http://schemas.microsoft.com/office/2011/relationships/commentsExtended'
const COMMENTS_CT = 'application/vnd.openxmlformats-officedocument.wordprocessingml.comments+xml'
const COMMENTS_EX_CT = 'application/vnd.openxmlformats-officedocument.wordprocessingml.commentsExtended+xml'

/** One remark: a thread's first comment or a reply. */
export interface Note {
  /** `w:id`, unique among the document's comments. */
  id: string
  author: string
  date: string
  text: string
  /** `w14:paraId` of the comment's last paragraph, which commentsExtended.xml keys threads by. */
  paraId: string
  /** Whether the engine's copy of the document holds this comment's markers (it came from the file). */
  inFile: boolean
}

/** Where a thread's text is: a paragraph, an offset into its text, and the text itself. */
export interface Anchor {
  paraId: string
  /** The paragraph's position, to find a nearby one when it is gone. */
  index: number
  start: number
  text: string
}

export interface Thread extends Note {
  replies: Note[]
  resolved: boolean
  anchor: Anchor
}

const parse = (xml: string) => new DOMParser().parseFromString(xml, 'application/xml')
const serialize = (doc: Document) =>
  '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\r\n' + new XMLSerializer().serializeToString(doc).replace(/^<\?xml[^>]*\?>\s*/, '')

const els = (root: Document | Element, name: string, ns = W) => Array.from(root.getElementsByTagNameNS(ns, name))
const attr = (el: Element, name: string, ns = W) => el.getAttributeNS(ns, name) ?? ''

export function initialsOf(name: string) {
  const parts = name.trim().split(/\s+/).filter(Boolean)
  return (parts.length > 1 ? parts[0][0] + parts[parts.length - 1][0] : (parts[0] ?? '?').slice(0, 2)).toUpperCase()
}

export function newParaId(taken: Set<string>) {
  // Word wants values below 0x80000000.
  let id = ''
  do id = Math.floor(Math.random() * 0x7fffffff).toString(16).toUpperCase().padStart(8, '0')
  while (taken.has(id))
  taken.add(id)
  return id
}

/** The text of a comment element, one line per paragraph. */
function noteText(comment: Element) {
  return els(comment, 'p')
    .map((p) => segments(p).map((s) => s.text).join(''))
    .join('\n')
    .trim()
}

/** The text pieces of a paragraph in order, skipping nested paragraphs (text boxes) and deleted text. */
function segments(p: Element) {
  const out: { el: Element; run: Element; text: string; start: number }[] = []
  let offset = 0
  const walk = (node: Element) => {
    for (const child of Array.from(node.children)) {
      if (child.namespaceURI === W && (child.localName === 'p' || child.localName === 'txbxContent' || child.localName === 'del' || child.localName === 'pPr' || child.localName === 'rPr'))
        continue
      if (child.namespaceURI === W && (child.localName === 't' || child.localName === 'tab')) {
        const text = child.localName === 't' ? (child.textContent ?? '') : '\t'
        const run = child.parentElement!
        out.push({ el: child, run, text, start: offset })
        offset += text.length
      } else {
        walk(child)
      }
    }
  }
  walk(p)
  return out
}

/** Characters of `p` that come before `marker`. */
function offsetOf(p: Element, marker: Element) {
  let n = 0
  for (const s of segments(p)) if (marker.compareDocumentPosition(s.el) & Node.DOCUMENT_POSITION_PRECEDING) n += s.text.length
  return n
}

/** The package path of the part a relationship of `type` from the main document points at. */
function partPath(rels: Document | null, type: string, fallback: string) {
  const rel = rels && els(rels, 'Relationship', REL).find((r) => r.getAttribute('Type') === type)
  const target = rel?.getAttribute('Target')
  if (!target) return fallback
  return target.startsWith('/') ? target.slice(1) : `word/${target}`
}

type Zip = import('jszip')

async function readPart(zip: Zip, path: string) {
  const text = await zip.file(path)?.async('string')
  return text ? parse(text) : null
}

/** Whether a .docx has a comments part, without parsing it. */
export async function hasComments(bytes: Uint8Array) {
  const { default: JSZip } = await import('jszip')
  const zip = await JSZip.loadAsync(bytes)
  return !!zip.file('word/comments.xml') || Object.keys(zip.files).some((f) => /^word\/comments\d*\.xml$/.test(f))
}

/** The comment threads in a .docx, anchored to their text. Use bytes the engine saved, so paragraph ids match its own. */
export async function readComments(bytes: Uint8Array): Promise<Thread[]> {
  const { default: JSZip } = await import('jszip')
  const zip = await JSZip.loadAsync(bytes)
  const rels = await readPart(zip, 'word/_rels/document.xml.rels')
  const comments = await readPart(zip, partPath(rels, COMMENTS_TYPE, 'word/comments.xml'))
  const doc = await readPart(zip, 'word/document.xml')
  if (!comments || !doc) return []
  const ex = await readPart(zip, partPath(rels, COMMENTS_EX_TYPE, 'word/commentsExtended.xml'))

  // commentsExtended.xml: which comment answers which, and which threads are done.
  const parentOf = new Map<string, string>()
  const done = new Set<string>()
  if (ex) {
    for (const c of els(ex, 'commentEx', W15)) {
      const id = attr(c, 'paraId', W15)
      const parent = attr(c, 'paraIdParent', W15)
      if (parent) parentOf.set(id, parent)
      if (attr(c, 'done', W15) === '1') done.add(id)
    }
  }

  const paragraphs = els(doc, 'p')
  const indexOf = new Map(paragraphs.map((p, i) => [p, i]))
  const anchorOf = (id: string): Anchor => {
    const start = els(doc, 'commentRangeStart').find((m) => attr(m, 'id') === id) ?? els(doc, 'commentReference').find((m) => attr(m, 'id') === id)
    const p = start?.closest('p')
    if (!start || !p) return { paraId: '', index: 0, start: 0, text: '' }
    const text = segments(p)
      .map((s) => s.text)
      .join('')
    const from = offsetOf(p, start)
    const end = els(doc, 'commentRangeEnd').find((m) => attr(m, 'id') === id)
    const to = end && end.closest('p') === p ? offsetOf(p, end) : text.length
    return { paraId: attr(p, 'paraId', W14), index: indexOf.get(p) ?? 0, start: from, text: start.localName === 'commentRangeStart' ? text.slice(from, to) : '' }
  }

  const notes = els(comments, 'comment').map((c): Note => {
    const lastP = els(c, 'p').at(-1)
    return {
      id: attr(c, 'id'),
      author: attr(c, 'author') || 'Unknown',
      date: attr(c, 'date'),
      text: noteText(c),
      paraId: lastP ? attr(lastP, 'paraId', W14) : '',
      inFile: true,
    }
  })
  const byParaId = new Map(notes.filter((n) => n.paraId).map((n) => [n.paraId, n]))
  // A reply's parent may itself be a reply; Word threads them all under the first comment.
  const rootOf = (note: Note) => {
    let root = note
    const seen = new Set([note])
    for (let parent = parentOf.get(root.paraId); parent && byParaId.has(parent) && !seen.has(byParaId.get(parent)!); parent = parentOf.get(root.paraId)) {
      root = byParaId.get(parent)!
      seen.add(root)
    }
    return root
  }
  const threadOf = new Map<Note, Thread>()
  for (const note of notes) {
    if (rootOf(note) === note) threadOf.set(note, { ...note, replies: [], resolved: done.has(note.paraId), anchor: anchorOf(note.id) })
  }
  for (const note of notes) {
    const root = rootOf(note)
    if (root !== note) threadOf.get(root)?.replies.push(note)
  }
  return [...threadOf.values()].sort((a, b) => a.anchor.index - b.anchor.index || a.anchor.start - b.anchor.start)
}

// ── Writing

/**
 * Split the run around `child` so that a marker can go right before `child`'s character `k`.
 * Answers the node to insert before, in the run's parent.
 */
function boundaryAt(child: Element, k: number): { parent: Node; before: Node | null } {
  const run = child.parentElement!
  if (child.localName === 't' && k > 0) {
    const text = child.textContent ?? ''
    const rest = child.cloneNode(false) as Element
    rest.setAttributeNS('http://www.w3.org/XML/1998/namespace', 'xml:space', 'preserve')
    rest.textContent = text.slice(k)
    child.setAttributeNS('http://www.w3.org/XML/1998/namespace', 'xml:space', 'preserve')
    child.textContent = text.slice(0, k)
    run.insertBefore(rest, child.nextSibling)
    child = rest
  }
  const content = Array.from(run.children).filter((c) => c.localName !== 'rPr')
  if (content[0] === child) return { parent: run.parentNode!, before: run }
  // Move `child` and what follows it into a copy of the run, with the same formatting.
  const tail = run.cloneNode(false) as Element
  const rPr = Array.from(run.children).find((c) => c.localName === 'rPr')
  if (rPr) tail.appendChild(rPr.cloneNode(true))
  for (let node: Node | null = child; node; ) {
    const next: Node | null = node.nextSibling
    tail.appendChild(node)
    node = next
  }
  run.parentNode!.insertBefore(tail, run.nextSibling)
  return { parent: run.parentNode!, before: tail }
}

/** Where a marker at text offset `offset` of paragraph `p` goes. */
function pointIn(p: Element, offset: number): { parent: Node; before: Node | null } {
  const segs = segments(p)
  const seg = segs.find((s) => offset < s.start + s.text.length && s.text.length > 0)
  if (seg) return boundaryAt(seg.el, offset - seg.start)
  const last = segs.at(-1)
  if (last) return { parent: last.run.parentNode!, before: last.run.nextSibling }
  return { parent: p, before: null }
}

function marker(doc: Document, name: string, id: string) {
  const el = doc.createElementNS(W, `w:${name}`)
  el.setAttributeNS(W, 'w:id', id)
  return el
}

function referenceRun(doc: Document, id: string) {
  const run = doc.createElementNS(W, 'w:r')
  run.appendChild(marker(doc, 'commentReference', id))
  return run
}

/** Find `anchor.text` in `text`, at the occurrence nearest `anchor.start`. */
export function nearest(text: string, needle: string, start: number) {
  if (!needle) return -1
  let best = -1
  for (let i = text.indexOf(needle); i !== -1; i = text.indexOf(needle, i + 1)) if (best === -1 || Math.abs(i - start) < Math.abs(best - start)) best = i
  return best
}

/** Put a new thread's range markers and reference into document.xml. */
function placeThread(doc: Document, paragraphs: Element[], t: Thread) {
  const p = paragraphs.find((el) => attr(el, 'paraId', W14) === t.anchor.paraId) ?? paragraphs[Math.min(t.anchor.index, paragraphs.length - 1)]
  if (!p) return
  const text = segments(p)
    .map((s) => s.text)
    .join('')
  const found = nearest(text, t.anchor.text, t.anchor.start)
  const start = found === -1 ? Math.min(t.anchor.start, text.length) : found
  const end = found === -1 ? start : start + t.anchor.text.length
  // The end first: splitting runs there leaves the offsets before it as they were.
  const e = pointIn(p, end)
  const endMarker = marker(doc, 'commentRangeEnd', t.id)
  e.parent.insertBefore(endMarker, e.before)
  e.parent.insertBefore(referenceRun(doc, t.id), endMarker.nextSibling)
  const s = start === end ? { parent: endMarker.parentNode!, before: endMarker } : pointIn(p, start)
  s.parent.insertBefore(marker(doc, 'commentRangeStart', t.id), s.before)
}

/** Put a new reply's markers beside its thread's, as Word does. */
function placeReply(doc: Document, threadId: string, reply: Note) {
  const start = els(doc, 'commentRangeStart').find((m) => attr(m, 'id') === threadId)
  const end = els(doc, 'commentRangeEnd').find((m) => attr(m, 'id') === threadId)
  if (start) start.parentNode!.insertBefore(marker(doc, 'commentRangeStart', reply.id), start.nextSibling)
  const ref = referenceRun(doc, reply.id)
  if (end) {
    const endMarker = marker(doc, 'commentRangeEnd', reply.id)
    end.parentNode!.insertBefore(endMarker, end.nextSibling)
    endMarker.parentNode!.insertBefore(ref, endMarker.nextSibling)
  } else {
    const thread = els(doc, 'commentReference').find((m) => attr(m, 'id') === threadId)?.parentElement
    thread?.parentNode!.insertBefore(ref, thread.nextSibling)
  }
}

function removeMarkers(doc: Document, ids: Set<string>) {
  for (const name of ['commentRangeStart', 'commentRangeEnd']) for (const m of els(doc, name)) if (ids.has(attr(m, 'id'))) m.remove()
  for (const ref of els(doc, 'commentReference')) {
    if (!ids.has(attr(ref, 'id'))) continue
    const run = ref.parentElement
    ref.remove()
    if (run?.localName === 'r' && !Array.from(run.children).some((c) => c.localName !== 'rPr')) run.remove()
  }
}

function commentElement(doc: Document, note: Note) {
  const c = doc.createElementNS(W, 'w:comment')
  c.setAttributeNS(W, 'w:id', note.id)
  c.setAttributeNS(W, 'w:author', note.author)
  c.setAttributeNS(W, 'w:date', note.date)
  c.setAttributeNS(W, 'w:initials', initialsOf(note.author))
  const lines = note.text.split('\n')
  lines.forEach((line, i) => {
    const p = doc.createElementNS(W, 'w:p')
    if (i === lines.length - 1) p.setAttributeNS(W14, 'w14:paraId', note.paraId)
    if (i === 0) {
      // The mark Word shows in front of a comment.
      const ref = doc.createElementNS(W, 'w:r')
      ref.appendChild(doc.createElementNS(W, 'w:annotationRef'))
      p.appendChild(ref)
    }
    const r = doc.createElementNS(W, 'w:r')
    const t = doc.createElementNS(W, 'w:t')
    t.setAttributeNS('http://www.w3.org/XML/1998/namespace', 'xml:space', 'preserve')
    t.textContent = line
    r.appendChild(t)
    p.appendChild(r)
    c.appendChild(p)
  })
  return c
}

const EMPTY_COMMENTS = `<w:comments xmlns:w="${W}" xmlns:w14="${W14}" xmlns:mc="${MC}" mc:Ignorable="w14"/>`
const EMPTY_COMMENTS_EX = `<w15:commentsEx xmlns:w15="${W15}" xmlns:mc="${MC}" mc:Ignorable="w15"/>`

/** Add a relationship and content type for a part, unless the package already has them. */
function ensurePart(rels: Document, types: Document, type: string, target: string, contentType: string) {
  if (!els(rels, 'Relationship', REL).some((r) => r.getAttribute('Type') === type)) {
    const taken = new Set(els(rels, 'Relationship', REL).map((r) => r.getAttribute('Id')))
    let n = 1
    while (taken.has(`rIdWs${n}`)) n++
    const rel = rels.createElementNS(REL, 'Relationship')
    rel.setAttribute('Id', `rIdWs${n}`)
    rel.setAttribute('Type', type)
    rel.setAttribute('Target', target)
    rels.documentElement.appendChild(rel)
  }
  const partName = `/word/${target}`
  if (!els(types, 'Override', CT).some((o) => o.getAttribute('PartName') === partName)) {
    const o = types.createElementNS(CT, 'Override')
    o.setAttribute('PartName', partName)
    o.setAttribute('ContentType', contentType)
    types.documentElement.appendChild(o)
  }
}

/**
 * Write the threads into a .docx the engine saved: markers for comments it doesn't know about,
 * none for deleted ones, and the comments parts rewritten to match.
 */
export async function writeComments(bytes: Uint8Array, threads: readonly Thread[], deleted: ReadonlySet<string>): Promise<Uint8Array> {
  const { default: JSZip } = await import('jszip')
  const zip = await JSZip.loadAsync(bytes)
  const rels = (await readPart(zip, 'word/_rels/document.xml.rels'))!
  const types = (await readPart(zip, '[Content_Types].xml'))!
  const doc = (await readPart(zip, 'word/document.xml'))!
  const commentsPath = partPath(rels, COMMENTS_TYPE, 'word/comments.xml')
  const exPath = partPath(rels, COMMENTS_EX_TYPE, 'word/commentsExtended.xml')
  const comments = (await readPart(zip, commentsPath)) ?? parse(EMPTY_COMMENTS)
  const ex = (await readPart(zip, exPath)) ?? parse(EMPTY_COMMENTS_EX)

  // document.xml
  removeMarkers(doc, new Set(deleted))
  const paragraphs = els(doc, 'p').filter((p) => !p.parentElement?.closest('txbxContent'))
  for (const t of threads) if (!t.inFile) placeThread(doc, paragraphs, t)
  for (const t of threads) for (const r of t.replies) if (!r.inFile) placeReply(doc, t.id, r)

  // comments.xml: drop deleted comments, add new ones. Comments from the file stay as they were.
  const root = comments.documentElement
  if (!root.lookupNamespaceURI('w14')) root.setAttributeNS('http://www.w3.org/2000/xmlns/', 'xmlns:w14', W14)
  const existing = new Map(els(comments, 'comment').map((c) => [attr(c, 'id'), c]))
  for (const [id, c] of existing) if (deleted.has(id)) c.remove()
  const notes = threads.flatMap((t) => [t as Note, ...t.replies])
  for (const note of notes) {
    const el = existing.get(note.id)
    if (el && !deleted.has(note.id)) {
      // An older file may have no paragraph ids; threads need one to be resolved or answered.
      const lastP = els(el, 'p').at(-1)
      if (lastP && !attr(lastP, 'paraId', W14)) lastP.setAttributeNS(W14, 'w14:paraId', note.paraId)
    } else if (!el) {
      root.appendChild(commentElement(comments, note))
    }
  }

  // commentsExtended.xml: replies point at their thread, resolved threads are done.
  const exRoot = ex.documentElement
  for (const c of els(ex, 'commentEx', W15)) c.remove()
  for (const t of threads) {
    const entry = (note: Note, parent?: string) => {
      const c = ex.createElementNS(W15, 'w15:commentEx')
      c.setAttributeNS(W15, 'w15:paraId', note.paraId)
      if (parent) c.setAttributeNS(W15, 'w15:paraIdParent', parent)
      c.setAttributeNS(W15, 'w15:done', t.resolved ? '1' : '0')
      exRoot.appendChild(c)
    }
    entry(t)
    for (const r of t.replies) entry(r, t.paraId)
  }

  // Word 2016+ also keeps durable ids per comment; drop the entries of deleted ones.
  const kept = new Set(notes.map((n) => n.paraId))
  const idsPath = Object.keys(zip.files).find((f) => /^word\/commentsIds\.xml$/i.test(f))
  if (idsPath && deleted.size) {
    const ids = (await readPart(zip, idsPath))!
    const durable = new Set<string>()
    for (const c of Array.from(ids.documentElement.children)) {
      const paraId = Array.from(c.attributes).find((a) => a.localName === 'paraId')?.value ?? ''
      if (kept.has(paraId)) durable.add(Array.from(c.attributes).find((a) => a.localName === 'durableId')?.value ?? '')
      else c.remove()
    }
    zip.file(idsPath, serialize(ids))
    const extensiblePath = Object.keys(zip.files).find((f) => /^word\/commentsExtensible\.xml$/i.test(f))
    const extensible = extensiblePath ? await readPart(zip, extensiblePath) : null
    if (extensiblePath && extensible) {
      for (const c of Array.from(extensible.documentElement.children)) {
        const id = Array.from(c.attributes).find((a) => a.localName === 'durableId')?.value
        if (id && !durable.has(id)) c.remove()
      }
      zip.file(extensiblePath, serialize(extensible))
    }
  }

  ensurePart(rels, types, COMMENTS_TYPE, commentsPath.replace(/^word\//, ''), COMMENTS_CT)
  ensurePart(rels, types, COMMENTS_EX_TYPE, exPath.replace(/^word\//, ''), COMMENTS_EX_CT)
  zip.file('word/document.xml', serialize(doc))
  zip.file(commentsPath, serialize(comments))
  zip.file(exPath, serialize(ex))
  zip.file('word/_rels/document.xml.rels', serialize(rels))
  zip.file('[Content_Types].xml', serialize(types))
  return zip.generateAsync({ type: 'uint8array', compression: 'DEFLATE' })
}

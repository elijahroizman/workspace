import { ArchiveRestore, ChevronsUpDown, Copy, History, MoreHorizontal, Pencil, Tag, X } from 'lucide-react'
import { useCallback, useEffect, useRef, useState } from 'react'
import { create } from 'zustand'
import type { DiffOp } from '../lib/diff'
import { diffLines } from '../lib/diff'
import { KINDS } from '../lib/kinds'
import type { FileVersion } from '../lib/platform'
import * as platform from '../lib/platform'
import { useSettings } from '../state/settings'
import { getEditor, useWorkspace } from '../state/workspace'
import { Button, EmptyState, IconButton, KindIcon, Modal, PillTabs, PopoverMenu, Spinner, TextField } from './ui'

/** Which tab's history is showing, if any. */
export const useVersionHistory = create<{ tabId: string | null; show(tabId: string | null): void }>((set) => ({
  tabId: null,
  show: (tabId) => set({ tabId }),
}))

/** Open the history of the tab in front, or explain why there isn't one. */
export function showVersionHistory(tabId = useWorkspace.getState().activeId) {
  const tab = useWorkspace.getState().tabs.find((t) => t.id === tabId)
  if (!tab) return
  if (!tab.path) {
    void platform.showError('Save this document first. Writan keeps a version each time you save a file.', 'No versions yet')
    return
  }
  if (!useSettings.getState().history) {
    void platform
      .confirmDialog('Version history is off, so Writan isn’t keeping copies when you save. Turn it on?', { okLabel: 'Turn On', kind: 'info' })
      .then((ok) => {
        if (!ok) return
        useSettings.getState().setHistory(true)
        useVersionHistory.getState().show(tabId)
      })
    return
  }
  useVersionHistory.getState().show(tabId)
}

const TEXT_KINDS = new Set(['md', 'txt', 'latex'])

/** What a version says, as lines, for comparing. Null for files that aren't text (PDF, pictures). */
async function readableText(kind: string, bytes: Uint8Array): Promise<string[] | null> {
  if (TEXT_KINDS.has(kind)) return new TextDecoder().decode(bytes).replace(/\r\n?/g, '\n').split('\n')
  if (kind !== 'docx' && kind !== 'pptx') return null
  const { default: JSZip } = await import('jszip')
  const zip = await JSZip.loadAsync(bytes)
  const paragraphs = (xml: string, tag: 'w' | 'a') =>
    xml
      .split(new RegExp(`</${tag}:p>`))
      .map((p) =>
        [...p.matchAll(new RegExp(`<${tag}:t(?:\\s[^>]*)?>([^<]*)</${tag}:t>|<${tag}:(tab|br)\\b`, 'g'))]
          .map((m) => (m[2] === 'tab' ? '\t' : m[2] === 'br' ? ' ' : decodeEntities(m[1])))
          .join(''),
      )
      .filter((line, i, all) => line.trim() || (i > 0 && all[i - 1].trim()))
  if (kind === 'docx') {
    const xml = await zip.file('word/document.xml')?.async('string')
    return xml ? paragraphs(xml, 'w') : null
  }
  const slides = Object.keys(zip.files)
    .map((name) => /^ppt\/slides\/slide(\d+)\.xml$/.exec(name))
    .filter((m): m is RegExpExecArray => !!m)
    .sort((a, b) => Number(a[1]) - Number(b[1]))
  const lines: string[] = []
  for (const [name, n] of slides) {
    lines.push(`── Slide ${n} ──`)
    lines.push(...paragraphs(await zip.file(name)!.async('string'), 'a').filter((l) => l.trim()))
  }
  return lines
}

function decodeEntities(s: string) {
  return s.replace(/&(amp|lt|gt|quot|apos|#\d+|#x[0-9a-f]+);/gi, (m, e: string) => {
    const named: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'" }
    if (named[e.toLowerCase()]) return named[e.toLowerCase()]
    const code = e[1] === 'x' || e[1] === 'X' ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10)
    return Number.isFinite(code) ? String.fromCodePoint(code) : m
  })
}

function dayName(time: number) {
  const d = new Date(time)
  const today = new Date()
  const yesterday = new Date(Date.now() - 86_400_000)
  if (d.toDateString() === today.toDateString()) return 'Today'
  if (d.toDateString() === yesterday.toDateString()) return 'Yesterday'
  return d.toLocaleDateString(undefined, { weekday: 'long', month: 'long', day: 'numeric', year: d.getFullYear() === today.getFullYear() ? undefined : 'numeric' })
}

const timeOf = (time: number) => new Date(time).toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' })

export function formatSize(n: number) {
  if (n < 1024) return `${n} B`
  if (n < 1024 * 1024) return `${Math.round(n / 1024)} KB`
  return `${(n / 1024 / 1024).toFixed(1)} MB`
}

type Compare = 'current' | 'previous'

/** One paragraph (or line) of the comparison. `change` is a paragraph edited in place, word by word. */
type Row = { type: 'same' | 'add' | 'del'; text: string } | { type: 'change'; parts: DiffOp[] } | { type: 'skip'; rows: Row[] }

const words = (s: string) => s.match(/\s+|[^\s]+/g) ?? []

/** A removed paragraph and an added one that mostly share their words are one edited paragraph. */
function edited(before: string, after: string): DiffOp[] | null {
  const parts = diffLines(words(before), words(after), 800)
  if (!parts) return null
  const kept = parts.reduce((n, p) => n + (p.type === 'same' && p.text.trim() ? p.text.length : 0), 0)
  return kept >= 0.4 * Math.max(before.length, after.length) ? parts : null
}

/** Paragraph diff → rows: edits paired up, long unchanged runs folded with `context` around changes. */
function toRows(ops: DiffOp[], context = 2): Row[] {
  const flat: Row[] = []
  for (let i = 0; i < ops.length; ) {
    if (ops[i].type === 'same') {
      flat.push(ops[i++] as Row)
      continue
    }
    const dels: string[] = []
    const adds: string[] = []
    while (i < ops.length && ops[i].type !== 'same') (ops[i].type === 'del' ? dels : adds).push(ops[i++].text)
    const pairs = Math.min(dels.length, adds.length)
    const rest: Row[] = []
    for (let j = 0; j < pairs; j++) {
      const parts = edited(dels[j], adds[j])
      if (parts) flat.push({ type: 'change', parts })
      else rest.push({ type: 'del', text: dels[j] }, { type: 'add', text: adds[j] })
    }
    flat.push(...rest, ...dels.slice(pairs).map((text) => ({ type: 'del' as const, text })), ...adds.slice(pairs).map((text) => ({ type: 'add' as const, text })))
  }
  const near = flat.map(() => false)
  flat.forEach((r, i) => {
    if (r.type === 'same') return
    for (let j = Math.max(0, i - context); j <= Math.min(flat.length - 1, i + context); j++) near[j] = true
  })
  const out: Row[] = []
  let run: Row[] = []
  const flush = () => {
    if (run.length > 1) out.push({ type: 'skip', rows: run })
    else out.push(...run)
    run = []
  }
  flat.forEach((r, i) => {
    if (near[i]) {
      flush()
      out.push(r)
    } else run.push(r)
  })
  flush()
  return out
}

interface Comparison {
  rows: Row[] | null
  added: number
  removed: number
  changed: number
}

function compareTexts(before: string[], after: string[]): Comparison {
  const ops = diffLines(before, after)
  if (!ops) return { rows: null, added: 0, removed: 0, changed: 0 }
  const rows = toRows(ops)
  const all = rows.flatMap((r) => (r.type === 'skip' ? r.rows : [r]))
  const count = (type: Row['type']) => all.filter((r) => r.type === type).length
  return { rows, added: count('add'), removed: count('del'), changed: count('change') }
}

const versionTitle = (v: FileVersion) => v.label || (v.source === 'original' ? 'Before Writan saved it' : v.source === 'outside' ? 'Changed outside Writan' : 'Saved')

export function VersionHistory() {
  const tabId = useVersionHistory((s) => s.tabId)
  const tab = useWorkspace((s) => s.tabs.find((t) => t.id === tabId))
  const close = useCallback(() => useVersionHistory.getState().show(null), [])
  const [versions, setVersions] = useState<FileVersion[] | null>(null)
  const [selected, setSelected] = useState<string | null>(null)
  const [compare, setCompare] = useState<Compare>('current')
  const [diff, setDiff] = useState<Comparison | 'binary' | 'first' | 'loading' | null>(null)
  const [message, setMessage] = useState('')
  const [renaming, setRenaming] = useState(false)
  const [menu, setMenu] = useState<{ x: number; y: number; id: string } | null>(null)
  const listRef = useRef<HTMLDivElement>(null)
  const path = tab?.path ?? null

  const refresh = useCallback(async () => {
    if (!path) return
    const list = await platform.listVersions(path).catch(() => [])
    setVersions(list)
    setSelected((cur) => (cur && list.some((v) => v.id === cur) ? cur : (list[0]?.id ?? null)))
  }, [path])

  useEffect(() => {
    void refresh()
  }, [refresh])

  // The tab closed underneath us.
  useEffect(() => {
    if (tabId && !tab) close()
  }, [tabId, tab, close])

  const version = versions?.find((v) => v.id === selected) ?? null
  const index = versions && version ? versions.indexOf(version) : -1

  // Compare the picked version with the document as it is now, or with the version before it.
  useEffect(() => {
    if (!tab || !path || !version || !versions) {
      setDiff(null)
      return
    }
    let live = true
    setDiff('loading')
    void (async () => {
      try {
        const bytes = await platform.readVersion(path, version.id)
        const text = await readableText(tab.kind, bytes)
        if (!text) return live && setDiff('binary')
        if (compare === 'previous') {
          const prev = versions[index + 1]
          if (!prev) return live && setDiff('first')
          const before = await readableText(tab.kind, await platform.readVersion(path, prev.id))
          // Previous → this one: what this version changed.
          if (live) setDiff(compareTexts(before ?? [], text))
          return
        }
        const editor = getEditor(tab.id)
        const now = await readableText(tab.kind, editor ? await editor.getBytes() : await platform.readFile(path))
        // This version → now: what restoring it would undo.
        if (live) setDiff(compareTexts(text, now ?? []))
      } catch (err) {
        console.warn('version diff', err)
        if (live) setDiff('binary')
      }
    })()
    return () => {
      live = false
    }
  }, [tab, path, version, versions, index, compare])

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.target instanceof HTMLInputElement) {
        if (e.key === 'Escape') (e.target as HTMLInputElement).blur()
        return
      }
      if (document.querySelector('.menu')) return
      if (e.key === 'Escape') close()
      else if ((e.key === 'ArrowDown' || e.key === 'ArrowUp') && versions?.length) {
        const i = Math.max(0, Math.min(versions.length - 1, index + (e.key === 'ArrowDown' ? 1 : -1)))
        setSelected(versions[i].id)
        requestAnimationFrame(() => listRef.current?.querySelector('[aria-selected="true"]')?.scrollIntoView({ block: 'nearest' }))
      } else return
      e.preventDefault()
      e.stopPropagation()
    }
    window.addEventListener('keydown', onKey, true)
    return () => window.removeEventListener('keydown', onKey, true)
  }, [close, versions, index])

  if (!tab || !path) return null
  const ext = KINDS[tab.kind]?.extensions[0] ?? ''
  const unit = tab.kind === 'docx' || tab.kind === 'pptx' ? 'paragraph' : 'line'

  const saveVersion = async () => {
    const label = message.trim()
    if (!(await useWorkspace.getState().save(tab.id, { label: label || undefined }))) return
    setMessage('')
    // The copy is written just after the save returns.
    window.setTimeout(() => void refresh(), 250)
  }

  const restore = async () => {
    if (!version) return
    const day = dayName(version.time)
    const when = day === 'Today' || day === 'Yesterday' ? `${day.toLowerCase()} at ${timeOf(version.time)}` : `${day} at ${timeOf(version.time)}`
    const ok = await platform.confirmDialog(`The document goes back to how it was ${day === 'Today' || day === 'Yesterday' ? when : `on ${when}`}. What it is now stays in the history, so you can come back to it.`, {
      title: `Restore this version of “${tab.title}”?`,
      okLabel: 'Restore',
      kind: 'info',
    })
    if (!ok) return
    const bytes = await platform.readVersion(path, version.id)
    if (await useWorkspace.getState().restoreVersion(tab.id, bytes, `Restored from ${when}`)) {
      window.setTimeout(() => void refresh(), 250)
    }
  }

  const openCopy = async (v = version) => {
    if (!v) return
    const bytes = await platform.readVersion(path, v.id)
    const stamp = new Date(v.time).toLocaleString(undefined, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }).replace(/[/:]/g, '.')
    const id = useWorkspace.getState().openUnsaved(bytes, `${tab.title} (${v.label || stamp}).${ext}`)
    if (id) close()
  }

  const remove = async (v = version) => {
    if (!v) return
    const ok = await platform.confirmDialog('This copy is deleted for good.', { title: 'Delete this version?', okLabel: 'Delete', danger: true })
    if (!ok) return
    await platform.deleteVersion(path, v.id)
    await refresh()
  }

  const rename = async (label: string) => {
    setRenaming(false)
    if (!version || label.trim() === (version.label ?? '')) return
    await platform.labelVersion(path, version.id, label.trim() || null)
    await refresh()
  }

  const menuVersion = menu && versions?.find((v) => v.id === menu.id)
  let lastDay = ''
  return (
    <Modal onClose={close}>
      <div className="vh" role="dialog" aria-modal="true" aria-label={`Version history of ${tab.title}`}>
        <section className="vh-main">
          <header className="vh-head">
            <div className="vh-head-title">
              <span className="vh-eyebrow">
                <History size={12} /> Version history · {tab.title}
              </span>
              {version && renaming ? (
                <TextField
                  className="vh-rename"
                  autoFocus
                  defaultValue={version.label ?? ''}
                  placeholder="Name this version"
                  onBlur={(e) => void rename(e.currentTarget.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') void rename(e.currentTarget.value)
                    if (e.key === 'Escape') setRenaming(false)
                  }}
                />
              ) : version ? (
                <button type="button" className="vh-name" title="Name this version (named versions are always kept)" onClick={() => setRenaming(true)}>
                  <h2>{version.label || new Date(version.time).toLocaleString(undefined, { weekday: 'long', month: 'long', day: 'numeric', hour: 'numeric', minute: '2-digit' })}</h2>
                  <Pencil size={13} />
                </button>
              ) : (
                <h2>{tab.title}</h2>
              )}
            </div>
            <div className="vh-actions">
              {version && (
                <>
                  <Button onClick={() => void openCopy()} title="Open this version in a new tab, without changing the file">
                    <Copy size={14} /> Open copy
                  </Button>
                  <Button variant="primary" disabled={index === 0 && !tab.dirty} onClick={() => void restore()}>
                    <ArchiveRestore size={14} /> Restore
                  </Button>
                </>
              )}
              <IconButton label="Close (Esc)" onClick={close}>
                <X size={16} />
              </IconButton>
            </div>
          </header>
          {version && (
            <div className="vh-toolbar">
              <PillTabs
                label="Compare"
                value={compare}
                onChange={setCompare}
                options={[
                  { value: 'current', label: 'Changes since this version' },
                  { value: 'previous', label: 'Changes in this save' },
                ]}
              />
              {diff && typeof diff === 'object' && diff.rows && (
                <span className="vh-legend">
                  {diff.changed > 0 && <span>{`${diff.changed} edited`}</span>}
                  {diff.added > 0 && <span className="vh-legend-add">{`${diff.added} added`}</span>}
                  {diff.removed > 0 && <span className="vh-legend-del">{`${diff.removed} removed`}</span>}
                </span>
              )}
            </div>
          )}
          <div className="vh-canvas">
            {versions?.length === 0 ? (
              <div className="vh-center">
                <EmptyState>No versions yet. Each time you save (or autosave), Writan keeps a copy here.</EmptyState>
              </div>
            ) : version ? (
              <DiffView diff={diff} compare={compare} kind={tab.kind} unit={unit} />
            ) : (
              <div className="vh-center">
                <Spinner />
              </div>
            )}
          </div>
        </section>

        <aside className="vh-side" aria-label="Versions">
          <form
            className="vh-save"
            onSubmit={(e) => {
              e.preventDefault()
              void saveVersion()
            }}
          >
            <TextField value={message} placeholder="Name this version (optional)" onChange={(e) => setMessage(e.currentTarget.value)} />
            <Button type="submit" variant="primary">
              Save
            </Button>
          </form>
          <div className="vh-list" role="listbox" ref={listRef} aria-label="Versions">
            {versions === null && <Spinner />}
            {versions?.map((v, i) => {
              const day = dayName(v.time)
              const heading = day !== lastDay
              lastDay = day
              return (
                <div key={v.id} role="presentation">
                  {heading && <div className="vh-day">{day}</div>}
                  <button
                    type="button"
                    role="option"
                    aria-selected={v.id === selected}
                    className={`vh-row ${v.id === selected ? 'on' : ''}`}
                    onClick={() => setSelected(v.id)}
                    onContextMenu={(e) => {
                      e.preventDefault()
                      setMenu({ x: e.clientX, y: e.clientY, id: v.id })
                    }}
                  >
                    <span className="vh-dot" data-latest={i === 0 || undefined} data-named={!!v.label || undefined} />
                    <span className="vh-row-text">
                      <span className="vh-row-top">
                        <strong>{timeOf(v.time)}</strong>
                        {i === 0 && <span className="vh-badge">Latest</span>}
                      </span>
                      <span className={`vh-row-title ${v.label ? 'named' : ''}`}>
                        {v.label && <Tag size={11} />}
                        {versionTitle(v)}
                      </span>
                      <span className="vh-row-meta">{formatSize(v.size)}</span>
                    </span>
                    <span
                      className="vh-row-more"
                      role="button"
                      aria-label="More"
                      onClick={(e) => {
                        e.stopPropagation()
                        const rect = (e.currentTarget as HTMLElement).getBoundingClientRect()
                        setMenu({ x: rect.right, y: rect.bottom + 4, id: v.id })
                      }}
                    >
                      <MoreHorizontal size={15} />
                    </span>
                  </button>
                </div>
              )
            })}
          </div>
          <p className="vh-footnote">Every save from the last hour is kept, then fewer as they get older. Named versions are always kept.</p>
        </aside>
      </div>
      {menu && menuVersion && (
        <PopoverMenu
          anchor={{ x: menu.x, y: menu.y, align: 'end' }}
          onClose={() => setMenu(null)}
          items={[
            {
              label: menuVersion.label ? 'Rename…' : 'Name this version…',
              onSelect: () => {
                setSelected(menuVersion.id)
                setRenaming(true)
              },
            },
            { label: 'Open copy', onSelect: () => void openCopy(menuVersion) },
            { label: 'Delete version', danger: true, separatorBefore: true, onSelect: () => void remove(menuVersion) },
          ]}
        />
      )}
    </Modal>
  )
}

function DiffView({ diff, compare, kind, unit }: { diff: Comparison | 'binary' | 'first' | 'loading' | null; compare: Compare; kind: string; unit: string }) {
  if (diff === 'loading' || diff === null) return <div className="vh-center">{diff && <Spinner />}</div>
  if (diff === 'first') {
    return (
      <div className="vh-center">
        <p className="muted">This is the oldest version kept, so there’s nothing earlier to compare it with.</p>
      </div>
    )
  }
  if (diff === 'binary') {
    return (
      <div className="vh-center">
        <div className="vh-note">
          <span className="vh-note-icon">
            <KindIcon kind={kind} size={22} />
          </span>
          <p>{KINDS[kind]?.label ?? 'This file'} versions can’t be compared here. Open a copy to look at this one, or restore it.</p>
        </div>
      </div>
    )
  }
  if (!diff.rows) {
    return (
      <div className="vh-center">
        <p className="muted">These two are too different to compare {unit} by {unit}. Open a copy to look at this one.</p>
      </div>
    )
  }
  if (!diff.added && !diff.removed && !diff.changed) {
    return (
      <div className="vh-center">
        <p className="muted">{compare === 'current' ? 'Nothing has changed since this version.' : 'No text changed in this save.'}</p>
      </div>
    )
  }
  return (
    <div className={`vh-page ${unit === 'line' ? 'lines' : ''} ${kind === 'latex' ? 'mono' : ''}`} role="document" aria-label="Changes">
      {diff.rows.map((r, i) => (
        <DiffRow key={i} row={r} unit={unit} />
      ))}
    </div>
  )
}

function DiffRow({ row, unit }: { row: Row; unit: string }) {
  const [open, setOpen] = useState(false)
  if (row.type === 'skip') {
    if (open) return row.rows.map((r, i) => <DiffRow key={i} row={r} unit={unit} />)
    return (
      <button type="button" className="vh-skip" onClick={() => setOpen(true)}>
        <ChevronsUpDown size={12} />
        {`${row.rows.length} unchanged ${unit}s`}
      </button>
    )
  }
  if (row.type === 'change') {
    return (
      <p className="vh-p change">
        {row.parts.map((p, i) => (p.type === 'same' ? p.text : p.type === 'add' ? <ins key={i}>{p.text}</ins> : <del key={i}>{p.text}</del>))}
      </p>
    )
  }
  const slide = /^── Slide (\d+) ──$/.exec(row.text)
  if (slide) return <h4 className={`vh-slide ${row.type}`}>Slide {slide[1]}</h4>
  return <p className={`vh-p ${row.type}`}>{row.text || ' '}</p>
}

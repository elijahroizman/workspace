import { ArchiveRestore, Copy, Pencil, Save, Tag, Trash2, X } from 'lucide-react'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { create } from 'zustand'
import type { DiffOp } from '../lib/diff'
import { diffLines, hunks } from '../lib/diff'
import { KINDS } from '../lib/kinds'
import type { FileVersion } from '../lib/platform'
import * as platform from '../lib/platform'
import { useSettings } from '../state/settings'
import { getEditor, useWorkspace } from '../state/workspace'
import { IconButton, Segmented, Spinner } from './ui'

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
    void platform.showError('Save this document first. Workspace keeps a version each time you save a file.', 'No versions yet')
    return
  }
  if (!useSettings.getState().history) {
    void platform
      .confirmDialog('Version history is off, so Workspace isn’t keeping copies when you save. Turn it on?', { okLabel: 'Turn On', kind: 'info' })
      .then((ok) => {
        if (!ok) return
        useSettings.getState().setHistory(true)
        useVersionHistory.getState().show(tabId)
      })
    return
  }
  useVersionHistory.getState().show(tabId)
}

const TEXT_KINDS = new Set(['md', 'txt', 'latex', 'mermaid'])

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

export function VersionHistory() {
  const tabId = useVersionHistory((s) => s.tabId)
  const tab = useWorkspace((s) => s.tabs.find((t) => t.id === tabId))
  const close = useCallback(() => useVersionHistory.getState().show(null), [])
  const [versions, setVersions] = useState<FileVersion[] | null>(null)
  const [selected, setSelected] = useState<string | null>(null)
  const [compare, setCompare] = useState<Compare>('current')
  const [diff, setDiff] = useState<{ ops: DiffOp[] | null; added: number; removed: number } | 'binary' | 'loading' | null>(null)
  const [message, setMessage] = useState('')
  const [renaming, setRenaming] = useState(false)
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
        const before = await readableText(tab.kind, bytes)
        if (!before) return live && setDiff('binary')
        let after: string[] | null
        if (compare === 'previous') {
          const prev = versions[index + 1]
          after = prev ? await readableText(tab.kind, await platform.readVersion(path, prev.id)) : []
          // Previous → this one: what this version changed.
          const ops = diffLines(after ?? [], before)
          if (live) setDiff({ ops, added: ops?.filter((o) => o.type === 'add').length ?? 0, removed: ops?.filter((o) => o.type === 'del').length ?? 0 })
          return
        }
        const editor = getEditor(tab.id)
        const now = editor ? await editor.getBytes() : await platform.readFile(path)
        after = await readableText(tab.kind, now)
        // This version → now: what restoring it would undo.
        const ops = diffLines(before, after ?? [])
        if (live) setDiff({ ops, added: ops?.filter((o) => o.type === 'add').length ?? 0, removed: ops?.filter((o) => o.type === 'del').length ?? 0 })
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

  const openCopy = async () => {
    if (!version) return
    const bytes = await platform.readVersion(path, version.id)
    const stamp = new Date(version.time).toLocaleString(undefined, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }).replace(/[/:]/g, '.')
    const id = useWorkspace.getState().openUnsaved(bytes, `${tab.title} (${version.label || stamp}).${ext}`)
    if (id) close()
  }

  const remove = async () => {
    if (!version) return
    const ok = await platform.confirmDialog('This copy is deleted for good.', { title: 'Delete this version?', okLabel: 'Delete', danger: true })
    if (!ok) return
    await platform.deleteVersion(path, version.id)
    await refresh()
  }

  const rename = async (label: string) => {
    setRenaming(false)
    if (!version || label.trim() === (version.label ?? '')) return
    await platform.labelVersion(path, version.id, label.trim() || null)
    await refresh()
  }

  let lastDay = ''
  return (
    <div className="settings-backdrop" onMouseDown={(e) => e.target === e.currentTarget && close()}>
      <div className="settings history" role="dialog" aria-modal="true" aria-label={`Version history of ${tab.title}`}>
        <nav className="settings-nav history-nav" aria-label="Versions">
          <h2>Version history</h2>
          <div className="history-list" role="listbox" ref={listRef} aria-label="Versions">
            {versions === null && <Spinner />}
            {versions?.length === 0 && <p className="history-empty">No versions yet. Each time you save (or autosave), a copy is kept here.</p>}
            {versions?.map((v, i) => {
              const day = dayName(v.time)
              const heading = day !== lastDay
              lastDay = day
              return (
                <div key={v.id} role="presentation">
                  {heading && <div className="history-day">{day}</div>}
                  <button type="button" role="option" aria-selected={v.id === selected} className={`settings-nav-item history-row ${v.id === selected ? 'on' : ''}`} onClick={() => setSelected(v.id)}>
                    <span className="history-dot" data-latest={i === 0 || undefined} />
                    <span className="history-row-text">
                      <span className="history-row-title">{v.label || (v.source === 'original' ? 'Before Workspace saved it' : i === 0 ? 'Latest save' : 'Saved')}</span>
                      <span className="history-row-meta">
                        {timeOf(v.time)} · {formatSize(v.size)}
                      </span>
                    </span>
                    {v.label && <Tag size={12} className="faint" />}
                  </button>
                </div>
              )
            })}
          </div>
          <form
            className="history-commit"
            onSubmit={(e) => {
              e.preventDefault()
              void saveVersion()
            }}
          >
            <label className="field">
              <input value={message} placeholder="Name this save (optional)" spellCheck={false} onChange={(e) => setMessage(e.currentTarget.value)} />
            </label>
            <button type="submit" className="btn">
              <Save size={14} /> Save version
            </button>
          </form>
        </nav>
        <div className="settings-page">
          <header className="settings-page-header">
            {version && renaming ? (
              <label className="field history-rename">
                <input
                  autoFocus
                  defaultValue={version.label ?? ''}
                  placeholder="Name this version"
                  onBlur={(e) => void rename(e.currentTarget.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') void rename(e.currentTarget.value)
                    if (e.key === 'Escape') setRenaming(false)
                  }}
                />
              </label>
            ) : version ? (
              <button type="button" className="history-name" title="Name this version (named versions are always kept)" onClick={() => setRenaming(true)}>
                <h3>{version.label || 'Unnamed version'}</h3>
                <Pencil size={12} />
              </button>
            ) : (
              <h3>{tab.title}</h3>
            )}
            <IconButton label="Close (esc)" onClick={close}>
              <X size={16} />
            </IconButton>
          </header>
          <div className="history-detail">
            {version ? (
              <>
                <div className="history-detail-head">
                  <span className="settings-hint">
                    {tab.title} · {new Date(version.time).toLocaleString(undefined, { dateStyle: 'full', timeStyle: 'short' })} · {formatSize(version.size)}
                  </span>
                  <div className="history-actions">
                    <IconButton label="Delete this version" onClick={() => void remove()}>
                      <Trash2 size={15} />
                    </IconButton>
                    <button type="button" className="btn" onClick={() => void openCopy()} title="Open this version in a new tab, without changing the file">
                      <Copy size={14} /> Open copy
                    </button>
                    <button type="button" className="btn primary" disabled={index === 0 && !tab.dirty} onClick={() => void restore()}>
                      <ArchiveRestore size={14} /> Restore
                    </button>
                  </div>
                </div>
                <div className="history-compare">
                  <Segmented
                    value={compare}
                    onChange={setCompare}
                    options={[
                      { value: 'current', label: 'Compare with now' },
                      { value: 'previous', label: 'What changed in this save' },
                    ]}
                  />
                  {diff && typeof diff === 'object' && diff.ops && (
                    <span className="history-stat">
                      <span className="add">+{diff.added}</span> <span className="del">−{diff.removed}</span> {tab.kind === 'docx' || tab.kind === 'pptx' ? 'paragraphs' : 'lines'}
                    </span>
                  )}
                </div>
                <DiffView diff={diff} compare={compare} kind={tab.kind} />
              </>
            ) : (
              versions?.length !== 0 && <Spinner />
            )}
          </div>
        </div>
      </div>
    </div>
  )
}

function DiffView({ diff, compare, kind }: { diff: { ops: DiffOp[] | null } | 'binary' | 'loading' | null; compare: Compare; kind: string }) {
  const rows = useMemo(() => (diff && typeof diff === 'object' && diff.ops ? hunks(diff.ops) : null), [diff])
  if (diff === 'loading' || diff === null) return <div className="history-diff center">{diff && <Spinner />}</div>
  if (diff === 'binary') {
    return (
      <div className="history-diff center muted">
        {KINDS[kind]?.label ?? 'This file'} versions can’t be compared here. Open a copy to look at this one, or restore it.
      </div>
    )
  }
  if (!rows) return <div className="history-diff center muted">These two are too different to compare line by line.</div>
  if (!rows.some((r) => r.type === 'add' || r.type === 'del')) {
    return <div className="history-diff center muted">{compare === 'current' ? 'No text changes since this version.' : 'No text changes in this save.'}</div>
  }
  return (
    <div className="history-diff" role="table" aria-label="Changes">
      {rows.map((r, i) =>
        r.type === 'skip' ? (
          <div key={i} className="diff-skip">
            ⋯ {r.count} unchanged {r.count === 1 ? 'line' : 'lines'}
          </div>
        ) : (
          <div key={i} className={`diff-line ${r.type}`}>
            <span className="diff-sign">{r.type === 'add' ? '+' : r.type === 'del' ? '−' : ' '}</span>
            <span className="diff-text">{r.text || ' '}</span>
          </div>
        ),
      )}
    </div>
  )
}

import { ChevronRight, ChevronsDownUp, Copy, File, Folder, FolderOpen, MoreHorizontal, RotateCw, Search, X } from 'lucide-react'
import { memo, useEffect, useMemo, useState } from 'react'
import { KINDS, kindFromPath } from '../lib/kinds'
import type { DirEntry } from '../lib/platform'
import { basename, dirname, isTauri, listDir, revealInFinder, revealLabel, walkDir } from '../lib/platform'
import { folderName, useFolder } from '../state/folder'
import { addPaletteSource } from './CommandPalette'
import { useWorkspace } from '../state/workspace'
import { KindIcon } from './Workbench'
import type { MenuEntry } from './ui'
import { IconButton, PopoverMenu } from './ui'

/** Every extension some plugin opens (on or off: opening one offers to turn its plugin on). */
const OPENABLE = [...new Set(Object.values(KINDS).flatMap((k) => k.extensions))]

/** A folder's entries, read when it's first shown and again after a refresh. */
const cache = new Map<string, Promise<DirEntry[]>>()
let cacheRev = -1
function entriesOf(path: string, rev: number) {
  if (rev !== cacheRev) {
    cache.clear()
    cacheRev = rev
  }
  let hit = cache.get(path)
  if (!hit) {
    hit = listDir(path).catch(() => [])
    cache.set(path, hit)
  }
  return hit
}

function useEntries(path: string) {
  const rev = useFolder((s) => s.rev)
  const [entries, setEntries] = useState<DirEntry[] | null>(null)
  useEffect(() => {
    let live = true
    void entriesOf(path, rev).then((e) => live && setEntries(e))
    return () => {
      live = false
    }
  }, [path, rev])
  return entries
}

type Menu = { x: number; y: number; entry: DirEntry }

export function Explorer() {
  const root = useFolder((s) => s.root)
  const showAll = useFolder((s) => s.showAll)
  const rev = useFolder((s) => s.rev)
  const [filter, setFilter] = useState('')
  const [menu, setMenu] = useState<Menu | null>(null)
  const [more, setMore] = useState<{ x: number; y: number } | null>(null)
  const { toggleVisible, collapseAll, refresh, close, setShowAll } = useFolder.getState()

  // Files change behind our back (Finder, sync apps): look again when the window comes back.
  useEffect(() => {
    const onFocus = () => useFolder.getState().refresh()
    window.addEventListener('focus', onFocus)
    return () => window.removeEventListener('focus', onFocus)
  }, [])

  if (!root) return null
  const menuItems = (entry: DirEntry): MenuEntry[] => [
    ...(!entry.isDir && kindFromPath(entry.name) ? [{ label: 'Open', onSelect: () => void useWorkspace.getState().openPaths([entry.path]) }] : []),
    ...(isTauri ? [{ label: revealLabel, icon: <FolderOpen size={14} />, onSelect: () => void revealInFinder(entry.path) }] : []),
    { label: 'Copy Path', icon: <Copy size={14} />, onSelect: () => void navigator.clipboard?.writeText(entry.path) },
  ]

  return (
    <aside className="explorer" aria-label="Folder">
      <div className="explorer-header">
        <span className="explorer-title" title={root}>
          {folderName(root)}
        </span>
        <IconButton label="Refresh" size="sm" onClick={refresh}>
          <RotateCw size={13} />
        </IconButton>
        <IconButton label="Collapse folders" size="sm" onClick={collapseAll}>
          <ChevronsDownUp size={13} />
        </IconButton>
        <IconButton
          label="More"
          size="sm"
          onClick={(e) => {
            const r = e.currentTarget.getBoundingClientRect()
            setMore({ x: r.left, y: r.bottom + 4 })
          }}
        >
          <MoreHorizontal size={14} />
        </IconButton>
      </div>
      <label className="explorer-filter">
        <Search size={13} className="faint" />
        <input
          value={filter}
          placeholder="Find a file"
          spellCheck={false}
          onChange={(e) => setFilter(e.currentTarget.value)}
          onKeyDown={(e) => {
            if (e.key === 'Escape') setFilter('')
          }}
        />
        {filter && (
          <button type="button" className="explorer-clear" aria-label="Clear" onClick={() => setFilter('')}>
            <X size={12} />
          </button>
        )}
      </label>
      <div className="explorer-tree" role="tree">
        {filter.trim() ? <Matches root={root} query={filter.trim()} rev={rev} onMenu={setMenu} /> : <DirChildren path={root} depth={0} showAll={showAll} onMenu={setMenu} />}
      </div>
      {menu && <PopoverMenu anchor={menu} onClose={() => setMenu(null)} items={menuItems(menu.entry)} />}
      {more && (
        <PopoverMenu
          anchor={more}
          onClose={() => setMore(null)}
          items={[
            { label: showAll ? 'Show Only Documents' : 'Show All Files', onSelect: () => setShowAll(!showAll) },
            ...(isTauri ? [{ label: revealLabel, icon: <FolderOpen size={14} />, onSelect: () => void revealInFinder(root) }] : []),
            { label: 'Hide Sidebar', separatorBefore: true, onSelect: toggleVisible },
            { label: 'Close Folder', onSelect: close },
          ]}
        />
      )}
    </aside>
  )
}

const DirChildren = memo(function DirChildren({ path, depth, showAll, onMenu }: { path: string; depth: number; showAll: boolean; onMenu(m: Menu): void }) {
  const entries = useEntries(path)
  if (!entries) return null
  const shown = entries.filter((e) => e.isDir || showAll || kindFromPath(e.name))
  if (!shown.length && depth === 0) return <p className="explorer-empty faint">{showAll ? 'This folder is empty.' : 'No documents in this folder.'}</p>
  return (
    <>
      {shown.map((e) => (e.isDir ? <DirRow key={e.path} entry={e} depth={depth} showAll={showAll} onMenu={onMenu} /> : <FileRow key={e.path} entry={e} depth={depth} onMenu={onMenu} />))}
    </>
  )
})

function DirRow({ entry, depth, showAll, onMenu }: { entry: DirEntry; depth: number; showAll: boolean; onMenu(m: Menu): void }) {
  const open = useFolder((s) => s.expanded.includes(entry.path))
  return (
    <>
      <button
        type="button"
        role="treeitem"
        aria-expanded={open}
        className="explorer-row dir"
        style={{ paddingLeft: 8 + depth * 14 }}
        onClick={() => useFolder.getState().toggleDir(entry.path)}
        onContextMenu={(e) => {
          e.preventDefault()
          onMenu({ x: e.clientX, y: e.clientY, entry })
        }}
      >
        <ChevronRight size={13} className={`explorer-chevron ${open ? 'open' : ''}`} />
        {open ? <FolderOpen size={14} /> : <Folder size={14} />}
        <span className="explorer-name">{entry.name}</span>
      </button>
      {open && (
        <div role="group">
          <DirChildren path={entry.path} depth={depth + 1} showAll={showAll} onMenu={onMenu} />
        </div>
      )}
    </>
  )
}

function FileRow({ entry, depth, detail, onMenu }: { entry: DirEntry; depth: number; detail?: string; onMenu(m: Menu): void }) {
  const kind = kindFromPath(entry.name)
  const active = useWorkspace((s) => s.tabs.find((t) => t.id === s.activeId)?.path === entry.path)
  const open = useWorkspace((s) => s.tabs.some((t) => t.path === entry.path))
  return (
    <button
      type="button"
      role="treeitem"
      className={`explorer-row file ${active ? 'active' : ''} ${open ? 'open' : ''} ${kind ? '' : 'other'}`}
      style={{ paddingLeft: 8 + depth * 14 + 17 }}
      title={entry.path}
      onClick={() => kind && void useWorkspace.getState().openPaths([entry.path])}
      onDoubleClick={() => !kind && void revealInFinder(entry.path)}
      onContextMenu={(e) => {
        e.preventDefault()
        onMenu({ x: e.clientX, y: e.clientY, entry })
      }}
    >
      <span className="explorer-icon" style={kind ? { color: KINDS[kind].color } : undefined}>
        {kind ? <KindIcon kind={kind} size={14} /> : <File size={14} />}
      </span>
      <span className="explorer-name">{entry.name}</span>
      {detail && <span className="explorer-detail">{detail}</span>}
    </button>
  )
}

/** Searching: every document under the folder whose name (or folder) has the letters typed. */
function Matches({ root, query, rev, onMenu }: { root: string; query: string; rev: number; onMenu(m: Menu): void }) {
  const [files, setFiles] = useState<string[] | null>(null)
  useEffect(() => {
    let live = true
    setFiles(null)
    void folderFiles(root, rev).then((f) => live && setFiles(f))
    return () => {
      live = false
    }
  }, [root, rev])
  const matches = useMemo(() => {
    if (!files) return []
    const q = query.toLowerCase()
    const scored: { path: string; score: number }[] = []
    for (const path of files) {
      const name = basename(path).toLowerCase()
      const rel = path.slice(root.length).toLowerCase()
      const at = name.indexOf(q)
      if (at !== -1) scored.push({ path, score: 1000 - at * 10 - name.length })
      else if (rel.includes(q)) scored.push({ path, score: 100 - rel.length })
      else if (subsequence(q, name)) scored.push({ path, score: -name.length })
    }
    return scored.sort((a, b) => b.score - a.score).slice(0, 200)
  }, [files, query, root])
  if (!files) return <p className="explorer-empty faint">Looking…</p>
  if (!matches.length) return <p className="explorer-empty faint">No documents match “{query}”.</p>
  return (
    <>
      {matches.map(({ path }) => (
        <FileRow key={path} entry={{ name: basename(path), path, isDir: false }} depth={0} detail={relativeDir(root, path)} onMenu={onMenu} />
      ))}
    </>
  )
}

function subsequence(q: string, text: string) {
  let i = 0
  for (const ch of text) if (ch === q[i]) i++
  return i === q.length
}

function relativeDir(root: string, path: string) {
  const dir = dirname(path)
  return dir.length > root.length ? dir.slice(root.length + 1) : ''
}

/** The open folder's documents in the command palette (⇧⌘P), read in the background. */
export function startFolderPalette() {
  let files: string[] = []
  let root: string | null = null
  const load = () => {
    const s = useFolder.getState()
    root = s.root
    files = []
    if (s.root) void folderFiles(s.root, s.rev).then((f) => root === s.root && (files = f))
  }
  load()
  const unsubscribe = useFolder.subscribe((s, prev) => {
    if (s.root !== prev.root || s.rev !== prev.rev) load()
  })
  const removeSource = addPaletteSource(() =>
    root
      ? files.map((path) => ({
          id: `folder:${path}`,
          label: basename(path),
          detail: relativeDir(root!, path) || folderName(root!),
          group: 'Folder' as const,
          icon: kindFromPath(path) ? <KindIcon kind={kindFromPath(path)!} /> : <File size={14} />,
          run: () => useWorkspace.getState().openPaths([path]),
        }))
      : [],
  )
  return () => {
    unsubscribe()
    removeSource()
  }
}

let walked: { key: string; files: Promise<string[]> } | null = null
/** Every document under the open folder (cached until a refresh). For search here and in the command palette. */
export function folderFiles(root: string, rev = useFolder.getState().rev) {
  const key = `${root}\n${rev}`
  if (walked?.key !== key) walked = { key, files: walkDir(root, OPENABLE).catch(() => []) }
  return walked.files
}

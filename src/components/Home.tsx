import { Folder, FolderOpen, FolderTree, MoreHorizontal, Moon, Settings, Sun, X } from 'lucide-react'
import { useMemo, useState } from 'react'
import type { DocKind } from '../lib/kinds'
import { KINDS } from '../lib/kinds'
import { basename, dirname, revealInFinder, revealLabel, isTauri, shortcut, tildify } from '../lib/platform'
import { chooseFolder, folderName, useFolder } from '../state/folder'
import { enabledKinds, usePlugins } from '../state/plugins'
import { useSettings } from '../state/settings'
import type { RecentFile } from '../state/workspace'
import { useWorkspace } from '../state/workspace'
import { DocBadge, KindIcon } from './Workbench'
import { IconButton, PopoverMenu } from './ui'

export function Home() {
  const recents = useWorkspace((s) => s.recents)
  const theme = useWorkspace((s) => s.theme)
  const { newDocument, openDialog, openPaths, removeRecent, setTheme } = useWorkspace.getState()
  const [filter, setFilter] = useState<DocKind | 'all'>('all')
  const [menu, setMenu] = useState<{ x: number; y: number; file: RecentFile } | null>(null)
  const plugins = usePlugins((s) => s.enabled)
  const kinds = enabledKinds(plugins)
  const recentTabs = useSettings((s) => s.recentTabs)
  const folders = useFolder((s) => s.recent)
  const openFolder = useFolder((s) => s.root)
  // Settings › General picks which file types get a tab. All always lists everything.
  const filters = kinds.filter((k) => recentTabs[k.id] !== false).map((k) => k.id)
  const shownFilter = filter === 'all' || filters.includes(filter) ? filter : 'all'

  const shown = useMemo(() => recents.filter((r) => shownFilter === 'all' || r.kind === shownFilter), [recents, shownFilter])

  return (
    <div className="home">
      <div className="home-inner">
        <header className="home-header">
          <div>
            <h1>Workspace</h1>
          </div>
          <div className="home-header-actions">
            <IconButton label={shortcut(theme === 'dark' ? 'Light appearance (⇧⌘L)' : 'Dark appearance (⇧⌘L)')} onClick={() => setTheme(theme === 'dark' ? 'light' : 'dark')}>
              {theme === 'dark' ? <Sun size={16} /> : <Moon size={16} />}
            </IconButton>
            <IconButton label={shortcut('Settings (⌘,)')} onClick={() => useSettings.getState().setOpen(true)}>
              <Settings size={16} />
            </IconButton>
          </div>
        </header>

        <div className="home-actions">
          <button type="button" className="home-card open" onClick={() => void openDialog()}>
            <span className="home-card-icon">
              <FolderOpen size={20} strokeWidth={1.75} />
            </span>
            <span className="home-card-text">
              <strong>Open…</strong>
              <span className="muted">Or drop files here</span>
            </span>
            <span className="kbd">{shortcut('⌘O')}</span>
          </button>
          <button
            type="button"
            className="home-card open"
            onClick={() => void chooseFolder()}
          >
            <span className="home-card-icon">
              <FolderTree size={20} strokeWidth={1.75} />
            </span>
            <span className="home-card-text">
              <strong>Open folder…</strong>
              <span className="muted">Its files in a sidebar</span>
            </span>
            <span className="kbd">{shortcut('⇧⌘O')}</span>
          </button>
          {kinds
            .filter((k) => k.create)
            .map((k) => (
              <button key={k.id} type="button" className="home-card" onClick={() => newDocument(k.id)}>
                <DocBadge kind={k.id} size={36} />
                <span className="home-card-text">
                  <strong>{k.create!.title}</strong>
                  <span className="muted">{k.create!.hint}</span>
                </span>
              </button>
            ))}
        </div>

        {folders.length > 0 && (
          <section className="home-folders">
            <h2>Folders</h2>
            <div className="home-folder-list">
              {folders.map((path) => (
                <div key={path} className={`home-folder ${openFolder === path ? 'on' : ''}`}>
                  <button type="button" title={tildify(path)} onClick={() => useFolder.getState().open(path)}>
                    <Folder size={14} />
                    <span className="home-folder-name">{folderName(path)}</span>
                    <span className="home-folder-path">{prettyDir(path)}</span>
                  </button>
                  <button type="button" className="home-folder-forget" aria-label={`Remove ${folderName(path)} from the list`} onClick={() => useFolder.getState().forgetRecent(path)}>
                    <X size={12} />
                  </button>
                </div>
              ))}
            </div>
          </section>
        )}

        <section className="home-recents">
          <div className="home-recents-header">
            <h2>Recent</h2>
            <div className="home-filter" role="tablist">
              {(['all', ...filters] as const).map((k) => (
                <button key={k} type="button" role="tab" aria-selected={shownFilter === k} className={shownFilter === k ? 'on' : ''} onClick={() => setFilter(k)}>
                  {k === 'all' ? 'All' : KINDS[k].short}
                </button>
              ))}
            </div>
          </div>

          {shown.length === 0 ? (
            <div className="home-empty">
              {recents.length === 0
                ? 'Files you open will show up here.'
                : `No recent ${shownFilter === 'all' ? '' : KINDS[shownFilter as DocKind].short.toLowerCase() + ' '}files.`}
            </div>
          ) : (
            <ul className="recent-list">
              {shown.map((r) => (
                <li key={r.path}>
                  <button
                    type="button"
                    className="recent-row"
                    onClick={() => void openPaths([r.path])}
                    onContextMenu={(e) => {
                      e.preventDefault()
                      setMenu({ x: e.clientX, y: e.clientY, file: r })
                    }}
                  >
                    <span className="recent-icon" style={{ color: KINDS[r.kind].color }}>
                      <KindIcon kind={r.kind} size={16} />
                    </span>
                    <span className="recent-name">{basename(r.path)}</span>
                    <span className="recent-path">{prettyDir(r.path)}</span>
                    <span className="recent-time">{relativeTime(r.openedAt)}</span>
                    <span
                      className="recent-more"
                      role="button"
                      aria-label="More"
                      onClick={(e) => {
                        e.stopPropagation()
                        const rect = (e.currentTarget as HTMLElement).getBoundingClientRect()
                        setMenu({ x: rect.right - 200, y: rect.bottom + 4, file: r })
                      }}
                    >
                      <MoreHorizontal size={16} />
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>
      {menu && (
        <PopoverMenu
          anchor={menu}
          onClose={() => setMenu(null)}
          items={[
            { label: 'Open', onSelect: () => void openPaths([menu.file.path]) },
            ...(isTauri ? [{ label: revealLabel, onSelect: () => void revealInFinder(menu.file.path) }] : []),
            { label: 'Remove from Recents', onSelect: () => removeRecent(menu.file.path), separatorBefore: true },
          ]}
        />
      )}
    </div>
  )
}

function prettyDir(path: string) {
  return tildify(dirname(path))
}

function relativeTime(ts: number) {
  const diff = Date.now() - ts
  const min = 60_000
  const hour = 60 * min
  const day = 24 * hour
  if (diff < min) return 'Just now'
  if (diff < hour) return `${Math.floor(diff / min)} min ago`
  if (diff < day) return `${Math.floor(diff / hour)} h ago`
  if (diff < 2 * day) return 'Yesterday'
  if (diff < 7 * day) return `${Math.floor(diff / day)} days ago`
  return new Date(ts).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: diff > 300 * day ? 'numeric' : undefined })
}

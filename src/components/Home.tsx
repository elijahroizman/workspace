import { FolderOpen, MoreHorizontal, Moon, Settings, Sun } from 'lucide-react'
import { useMemo, useState } from 'react'
import type { DocKind } from '../lib/kinds'
import { KINDS } from '../lib/kinds'
import { basename, dirname, revealInFinder, revealLabel, isTauri, shortcut, tildify } from '../lib/platform'
import { useSettings } from '../state/settings'
import type { RecentFile } from '../state/workspace'
import { useWorkspace } from '../state/workspace'
import { DocBadge, KindIcon } from './Workbench'
import { IconButton, PopoverMenu } from './ui'

const CREATE: { kind: DocKind; title: string; hint: string; shortcut: string }[] = [
  { kind: 'docx', title: 'New document', hint: 'Word (.docx)', shortcut: '⌘N' },
  { kind: 'pptx', title: 'New presentation', hint: 'PowerPoint (.pptx)', shortcut: '⇧⌘N' },
  { kind: 'md', title: 'New note', hint: 'Markdown (.md)', shortcut: '⌥⌘N' },
  { kind: 'txt', title: 'New text file', hint: 'Plain text (.txt)', shortcut: '' },
]

export function Home() {
  const recents = useWorkspace((s) => s.recents)
  const theme = useWorkspace((s) => s.theme)
  const { newDocument, openDialog, openPaths, removeRecent, setTheme } = useWorkspace.getState()
  const [filter, setFilter] = useState<DocKind | 'all'>('all')
  const [menu, setMenu] = useState<{ x: number; y: number; file: RecentFile } | null>(null)

  const shown = useMemo(() => recents.filter((r) => filter === 'all' || r.kind === filter), [recents, filter])

  return (
    <div className="home">
      <div className="home-inner">
        <header className="home-header">
          <div>
            <h1>Workspace</h1>
            <p className="muted">Open, edit and create Word, PowerPoint, PDF, Markdown and text files.</p>
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
          {CREATE.map((c) => (
            <button key={c.kind} type="button" className="home-card" onClick={() => newDocument(c.kind)}>
              <DocBadge kind={c.kind} size={36} />
              <span className="home-card-text">
                <strong>{c.title}</strong>
                <span className="muted">{c.hint}</span>
              </span>
              {c.shortcut && <span className="kbd">{shortcut(c.shortcut)}</span>}
            </button>
          ))}
        </div>

        <section className="home-recents">
          <div className="home-recents-header">
            <h2>Recent</h2>
            <div className="home-filter" role="tablist">
              {(['all', 'docx', 'pptx', 'pdf', 'md', 'txt'] as const).map((k) => (
                <button key={k} type="button" role="tab" aria-selected={filter === k} className={filter === k ? 'on' : ''} onClick={() => setFilter(k)}>
                  {k === 'all' ? 'All' : KINDS[k].short}
                </button>
              ))}
            </div>
          </div>

          {shown.length === 0 ? (
            <div className="home-empty">
              {recents.length === 0
                ? 'Files you open will show up here.'
                : `No recent ${filter === 'all' ? '' : KINDS[filter as DocKind].short.toLowerCase() + ' '}files.`}
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

import { FileText, PanelLeft, PanelRight, Search, X, ChevronUp, ChevronDown } from 'lucide-react'
import type { ReactNode } from 'react'
import { useEffect, useRef, useState } from 'react'
import type { DocKind } from '../lib/kinds'
import { KINDS } from '../lib/kinds'
import type { DocTab } from '../state/workspace'
import { useWorkspace } from '../state/workspace'
import { IconButton } from './ui'

export function KindIcon({ kind, size = 14 }: { kind: DocKind; size?: number }) {
  const Icon = KINDS[kind]?.icon ?? FileText
  return <Icon size={size} strokeWidth={1.75} />
}

export function DocBadge({ kind, size = 22 }: { kind: DocKind; size?: number }) {
  return (
    <span className="doc-icon" style={{ background: KINDS[kind].color, width: size, height: size }}>
      <KindIcon kind={kind} size={Math.round(size * 0.62)} />
    </span>
  )
}

const WIDTH_KEY = 'workspace.sidebarWidths'
const savedWidths = (() => {
  try {
    return JSON.parse(localStorage.getItem(WIDTH_KEY) || '{}') as { left?: number; right?: number; explorer?: number }
  } catch {
    return {}
  }
})()
if (savedWidths.left) document.documentElement.style.setProperty('--left-w', `${savedWidths.left}px`)
if (savedWidths.right) document.documentElement.style.setProperty('--right-w', `${savedWidths.right}px`)
if (savedWidths.explorer) document.documentElement.style.setProperty('--explorer-w', `${savedWidths.explorer}px`)

/** The drag handle on a sidebar's inner edge. `explorer` is the open folder's sidebar, at the far left. */
export function Resizer({ side }: { side: 'left' | 'right' | 'explorer' }) {
  const [dragging, setDragging] = useState(false)
  return (
    <div
      className={`sidebar-resizer ${dragging ? 'dragging' : ''}`}
      onPointerDown={(e) => {
        e.preventDefault()
        const el = e.currentTarget
        el.setPointerCapture(e.pointerId)
        setDragging(true)
        const startX = e.clientX
        const startW = (el.parentElement as HTMLElement).getBoundingClientRect().width
        const onMove = (ev: PointerEvent) => {
          const delta = side === 'right' ? startX - ev.clientX : ev.clientX - startX
          const w = Math.round(Math.min(440, Math.max(200, startW + delta)))
          document.documentElement.style.setProperty(`--${side}-w`, `${w}px`)
        }
        const onUp = () => {
          setDragging(false)
          el.removeEventListener('pointermove', onMove)
          el.removeEventListener('pointerup', onUp)
          const w = parseInt(getComputedStyle(document.documentElement).getPropertyValue(`--${side}-w`))
          localStorage.setItem(WIDTH_KEY, JSON.stringify({ ...savedWidths, [side]: w }))
          savedWidths[side] = w
        }
        el.addEventListener('pointermove', onMove)
        el.addEventListener('pointerup', onUp)
      }}
      onDoubleClick={() => {
        document.documentElement.style.removeProperty(`--${side}-w`)
        delete savedWidths[side]
        localStorage.setItem(WIDTH_KEY, JSON.stringify(savedWidths))
      }}
    />
  )
}

/**
 * Three-pane layout shared by every editor: a navigation sidebar on the left,
 * the document in the middle, and an inspector on the right. Which panels are
 * open is remembered per document type.
 */
export function Workbench({
  tab,
  left,
  leftFooter,
  right,
  children,
}: {
  tab: DocTab
  left?: ReactNode
  leftFooter?: ReactNode
  right?: ReactNode
  children: ReactNode
}) {
  // In split view the panels start hidden, to leave room for both documents.
  const split = useWorkspace((s) => (s.split?.includes(tab.id) ? (s.splitPanels[tab.id] ?? NO_PANELS) : null))
  const leftShown = useWorkspace((s) => s.leftOpen[tab.kind])
  const rightShown = useWorkspace((s) => s.rightOpen[tab.kind])
  const leftOpen = left != null && (split ? split.left : leftShown)
  const rightOpen = right != null && (split ? split.right : rightShown)
  const toggleLeft = (kind: DocKind) => useWorkspace.getState().toggleLeft(kind, tab.id)
  const toggleRight = (kind: DocKind) => useWorkspace.getState().toggleRight(kind, tab.id)

  return (
    <div className="workbench">
      {leftOpen && (
        <aside className="pane left" aria-label="Sidebar">
          <div className="sidebar-header">
            <DocBadge kind={tab.kind} />
            <span className="title" title={tab.path ?? tab.title}>
              {tab.title}
            </span>
            <IconButton label="Hide sidebar (⌘\)" onClick={() => toggleLeft(tab.kind)}>
              <PanelLeft size={16} />
            </IconButton>
          </div>
          <div className="sidebar-scroll">{left}</div>
          {leftFooter && <div className="sidebar-footer">{leftFooter}</div>}
          <Resizer side="left" />
        </aside>
      )}
      <main className="canvas">
        {(!leftOpen && left != null) || (!rightOpen && right != null) ? (
          <div className="canvas-toggles">
            {!leftOpen && left != null ? (
              <IconButton label="Show sidebar (⌘\)" onClick={() => toggleLeft(tab.kind)}>
                <PanelLeft size={16} />
              </IconButton>
            ) : (
              <span />
            )}
            {!rightOpen && right != null && (
              <IconButton label="Show inspector (⌥⌘\)" onClick={() => toggleRight(tab.kind)}>
                <PanelRight size={16} />
              </IconButton>
            )}
          </div>
        ) : null}
        {children}
      </main>
      {rightOpen && (
        <aside className="pane right" aria-label="Inspector">
          <div className="sidebar-scroll">{right}</div>
          <Resizer side="right" />
        </aside>
      )}
    </div>
  )
}

const NO_PANELS = { left: false, right: false }

/** Inspector header row with the panel toggle, mirroring the left sidebar header. */
export function InspectorHeader({ kind, children }: { kind: DocKind; children?: ReactNode }) {
  const toggleRight = useWorkspace((s) => s.toggleRight)
  return (
    <div className="sidebar-header inspector-header">
      <div className="title">{children}</div>
      <IconButton label="Hide inspector (⌥⌘\)" onClick={() => toggleRight(kind)}>
        <PanelRight size={16} />
      </IconButton>
    </div>
  )
}

/** Floating find box used by every editor. */
export function FindBar({
  open,
  onClose,
  onQuery,
  onNext,
  onPrev,
  count,
  current,
  placeholder = 'Find in document',
}: {
  open: boolean
  onClose: () => void
  onQuery: (query: string) => void
  onNext: () => void
  onPrev: () => void
  count: number | null
  current: number | null
  placeholder?: string
}) {
  const input = useRef<HTMLInputElement>(null)
  const [query, setQuery] = useState('')

  useEffect(() => {
    if (open) {
      input.current?.focus()
      input.current?.select()
    }
  }, [open])

  if (!open) return null
  return (
    <div className="find-bar" role="search">
      <Search size={14} className="faint" />
      <input
        ref={input}
        value={query}
        placeholder={placeholder}
        spellCheck={false}
        onChange={(e) => {
          setQuery(e.currentTarget.value)
          onQuery(e.currentTarget.value)
        }}
        onKeyDown={(e) => {
          if (e.key === 'Enter') {
            e.preventDefault()
            if (e.shiftKey) onPrev()
            else onNext()
          } else if (e.key === 'Escape') {
            e.preventDefault()
            onClose()
          }
        }}
      />
      <span className="count">{query && count != null ? (count === 0 ? 'No results' : `${(current ?? 0) + 1} of ${count}`) : ''}</span>
      <IconButton label="Previous (⇧↩)" size="sm" onClick={onPrev} disabled={!count}>
        <ChevronUp size={14} />
      </IconButton>
      <IconButton label="Next (↩)" size="sm" onClick={onNext} disabled={!count}>
        <ChevronDown size={14} />
      </IconButton>
      <IconButton label="Close (esc)" size="sm" onClick={onClose}>
        <X size={14} />
      </IconButton>
    </div>
  )
}

export function formatZoom(zoom: number) {
  return `${Math.round(zoom * 100)}%`
}

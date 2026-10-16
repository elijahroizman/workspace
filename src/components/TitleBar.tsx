import { Cloud, CloudAlert, CloudCheck, CloudOff, Copy, FolderOpen, LayoutGrid, Plus, X } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import { autosaveBlocker, autosaveFolder, useAutosaveStatus } from '../lib/autosave'
import { isMac, isTauri, revealInFinder, revealLabel, shortcut, tildify } from '../lib/platform'
import { useSettings } from '../state/settings'
import { HOME_TAB_ID, useWorkspace } from '../state/workspace'
import { UpdateButton } from './UpdateButton'
import { KindIcon } from './Workbench'
import { PopoverMenu } from './ui'

export function TitleBar() {
  const tabs = useWorkspace((s) => s.tabs)
  const activeId = useWorkspace((s) => s.activeId)
  const { activate, closeTab, moveTab, newDocument, openDialog, duplicateTab, closeOthers } = useWorkspace.getState()
  const [menu, setMenu] = useState<{ x: number; y: number } | null>(null)
  const [tabMenu, setTabMenu] = useState<{ x: number; y: number; id: string } | null>(null)
  const [fullscreen, setFullscreen] = useState(false)
  const [drag, setDrag] = useState<{ id: string; dx: number } | null>(null)
  const tabRefs = useRef(new Map<string, HTMLDivElement>())

  // Traffic lights disappear in full screen, so reclaim their space.
  useEffect(() => {
    if (!isTauri || !isMac) return
    let unlisten: (() => void) | undefined
    void import('@tauri-apps/api/window').then(async ({ getCurrentWindow }) => {
      const win = getCurrentWindow()
      setFullscreen(await win.isFullscreen())
      unlisten = await win.onResized(async () => setFullscreen(await win.isFullscreen()))
    })
    return () => unlisten?.()
  }, [])

  /** Pointer-driven reordering (HTML5 drag-and-drop is owned by the native file drop handler). */
  const startDrag = (e: React.PointerEvent, id: string) => {
    if (e.button !== 0 || (e.target as HTMLElement).closest('.tab-close')) return
    activate(id)
    const el = e.currentTarget as HTMLElement
    el.setPointerCapture(e.pointerId)
    const rectOf = (tabId: string | undefined) => (tabId ? tabRefs.current.get(tabId)?.getBoundingClientRect() : undefined)
    // Where the pointer would be if the tab hadn't moved; shifts as the tab swaps places.
    let anchorX = e.clientX
    let moved = false

    const onMove = (ev: PointerEvent) => {
      if (!moved && Math.abs(ev.clientX - anchorX) < 4) return
      moved = true
      const order = useWorkspace.getState().tabs.map((t) => t.id)
      const index = order.indexOf(id)
      const next = rectOf(order[index + 1])
      const prev = rectOf(order[index - 1])
      if (next && ev.clientX > next.left + next.width / 2) {
        moveTab(id, index + 1)
        anchorX += next.width + 2
      } else if (prev && ev.clientX < prev.left + prev.width / 2) {
        moveTab(id, index - 1)
        anchorX -= prev.width + 2
      }
      setDrag({ id, dx: ev.clientX - anchorX })
    }
    const onUp = () => {
      el.removeEventListener('pointermove', onMove)
      el.removeEventListener('pointerup', onUp)
      el.removeEventListener('pointercancel', onUp)
      setDrag(null)
    }
    el.addEventListener('pointermove', onMove)
    el.addEventListener('pointerup', onUp)
    el.addEventListener('pointercancel', onUp)
  }

  return (
    <header className={`titlebar ${isMac && isTauri ? 'mac' : ''} ${fullscreen ? 'fullscreen' : ''}`} data-tauri-drag-region>
      <div className="tabs" role="tablist" data-tauri-drag-region>
        <div
          role="tab"
          aria-selected={activeId === HOME_TAB_ID}
          className={`tab tab-home ${activeId === HOME_TAB_ID ? 'active' : ''}`}
          title={shortcut('Home (⌘1)')}
          onPointerDown={() => activate(HOME_TAB_ID)}
        >
          <span className="tab-icon">
            <LayoutGrid size={15} strokeWidth={1.75} />
          </span>
          <span className="tab-title">Home</span>
        </div>
        {tabs.map((tab) => {
          const active = tab.id === activeId
          const dragging = drag?.id === tab.id
          return (
            <div
              key={tab.id}
              ref={(el) => {
                if (el) tabRefs.current.set(tab.id, el)
                else tabRefs.current.delete(tab.id)
              }}
              role="tab"
              aria-selected={active}
              className={`tab ${active ? 'active' : ''} ${tab.dirty ? 'dirty' : ''} ${dragging ? 'dragging' : ''}`}
              title={tab.path ?? tab.title}
              style={dragging ? { transform: `translateX(${drag.dx}px)` } : undefined}
              onPointerDown={(e) => startDrag(e, tab.id)}
              onAuxClick={(e) => {
                if (e.button === 1) void closeTab(tab.id)
              }}
              onContextMenu={(e) => {
                e.preventDefault()
                activate(tab.id)
                setTabMenu({ x: e.clientX, y: e.clientY, id: tab.id })
              }}
            >
              <span className="tab-icon">
                <KindIcon kind={tab.kind} size={15} />
              </span>
              <span className="tab-title">{tab.title}</span>
              <button
                type="button"
                className="tab-close"
                aria-label={tab.dirty ? `Close ${tab.title} (unsaved changes)` : `Close ${tab.title}`}
                title={shortcut(tab.dirty ? 'Unsaved changes — close (⌘W)' : 'Close (⌘W)')}
                onClick={(e) => {
                  e.stopPropagation()
                  void closeTab(tab.id)
                }}
              >
                <span className="dirty-dot" style={tab.dirty ? undefined : { display: 'none' }} />
                <X size={13} className="x" />
              </button>
            </div>
          )
        })}
      </div>
      <button
        type="button"
        className="icon-btn new-tab-btn"
        aria-label="New"
        title="New document or open a file"
        onClick={(e) => {
          const r = e.currentTarget.getBoundingClientRect()
          setMenu({ x: r.left, y: r.bottom + 6 })
        }}
      >
        <Plus size={16} />
      </button>
      <div className="titlebar-spacer" data-tauri-drag-region />
      <AutosaveChip />
      <UpdateButton />
      {tabMenu && (
        <PopoverMenu
          anchor={tabMenu}
          onClose={() => setTabMenu(null)}
          items={[
            { label: 'Duplicate Tab', icon: <Copy size={14} />, shortcut: '⇧⌘D', onSelect: () => void duplicateTab(tabMenu.id) },
            ...(isTauri && tabs.find((t) => t.id === tabMenu.id)?.path
              ? [{ label: revealLabel, icon: <FolderOpen size={14} />, onSelect: () => void revealInFinder(tabs.find((t) => t.id === tabMenu.id)!.path!) }]
              : []),
            { label: 'Close Tab', shortcut: '⌘W', separatorBefore: true, onSelect: () => void closeTab(tabMenu.id) },
            { label: 'Close Other Tabs', onSelect: () => void closeOthers(tabMenu.id) },
          ]}
        />
      )}
      {menu && (
        <PopoverMenu
          anchor={menu}
          onClose={() => setMenu(null)}
          items={[
            { label: 'New Document', icon: <KindIcon kind="docx" />, shortcut: '⌘N', onSelect: () => newDocument('docx') },
            { label: 'New Presentation', icon: <KindIcon kind="pptx" />, shortcut: '⇧⌘N', onSelect: () => newDocument('pptx') },
            { label: 'New Markdown Note', icon: <KindIcon kind="md" />, shortcut: '⌥⌘N', onSelect: () => newDocument('md') },
            { label: 'New Text File', icon: <KindIcon kind="txt" />, onSelect: () => newDocument('txt') },
            { label: 'Open…', icon: <FolderOpen size={14} />, shortcut: '⌘O', onSelect: () => void openDialog(), separatorBefore: true },
          ]}
        />
      )}
    </header>
  )
}

/** Where the active tab autosaves to, and how the last autosave went. Opens Settings. */
function AutosaveChip() {
  const tabs = useWorkspace((s) => s.tabs)
  const activeId = useWorkspace((s) => s.activeId)
  const autosave = useSettings((s) => s.autosave)
  const status = useAutosaveStatus((s) => s[activeId])
  const tab = tabs.find((t) => t.id === activeId)
  if (!tab || !autosave.root) return null

  const blocker = autosaveBlocker(tab, autosave)
  let icon = <Cloud size={14} />
  let text = ''
  let tone = ''
  let title = tab.path ? `Autosaves to ${tildify(tab.path)}` : `Autosaves to ${tildify(autosaveFolder(autosave)!)} once you start editing`
  if (blocker) {
    icon = <CloudOff size={14} />
    text = 'Not autosaved'
    title = `${blocker} ${shortcut('Save with ⌘S.')}`
  } else if (status?.state === 'error') {
    icon = <CloudAlert size={14} />
    text = 'Couldn’t autosave'
    tone = 'error'
    title = status.message ?? ''
  } else if (status?.state === 'saving') {
    text = 'Saving…'
  } else if (status?.state === 'saved' && !tab.dirty) {
    icon = <CloudCheck size={14} />
    text = 'Saved'
  }
  return (
    <button type="button" className={`autosave-chip ${tone}`} title={`${title}\nClick to change autosave settings.`} onClick={() => useSettings.getState().setOpen(true)}>
      {icon}
      {text && <span>{text}</span>}
    </button>
  )
}

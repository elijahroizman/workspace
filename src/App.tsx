import { Component, lazy, memo, Suspense, useEffect, useRef, useState } from 'react'
import type { ComponentType, ErrorInfo, ReactNode } from 'react'
import { CommandPalette, usePalette } from './components/CommandPalette'
import { FocusMode } from './components/FocusMode'
import { Explorer } from './components/Explorer'
import { Home } from './components/Home'
import { showVersionHistory, useVersionHistory, VersionHistory } from './components/VersionHistory'
import { NewFilePicker, useNewFile } from './components/NewFile'
import { TexInstall, TexRemove } from './components/TexInstall'
import { Dialogs } from './components/Dialogs'
import { TitleBar } from './components/TitleBar'
import { CenterState } from './components/ui'
import type { DocKind } from './lib/kinds'
import * as platform from './lib/platform'
import { flushAutosave, startAutosave } from './lib/autosave'
import { installUpdate, openUpdatePanel, startUpdateChecks } from './lib/updater'
import { startPlugins } from './state/plugins'
import { dimming, useFocus } from './state/focus'
import { chooseFolder, useFolder } from './state/folder'
import { useExtraFonts } from './state/fonts'
import { useSettings } from './state/settings'
import { useSetup } from './state/setup'
import { useTex } from './state/tex'
import type { Scope } from './state/shortcuts'
import { keysFor, keysFromEvent, movedBuiltIn, shortcutFor, syncMenu } from './state/shortcuts'
import type { DocTab } from './state/workspace'
import { getEditor, HOME_TAB_ID, persistSession, restoreSession, useWorkspace } from './state/workspace'

export interface EditorProps {
  tab: DocTab
  active: boolean
  /** On screen in split view's other pane: not focused, but not to be put to sleep either. */
  visible?: boolean
}

// Each editor (and its heavy engine) loads only when a tab of that type opens,
// which keeps launch fast. Built-in plugins' editors are part of the app; optional plugins
// run in PluginEditor (see plugins/api.ts).
const BUILT_IN_EDITORS: Record<string, React.LazyExoticComponent<ComponentType<EditorProps>>> = {
  md: lazy(() => import('./editors/markdown/MarkdownEditor')),
  txt: lazy(() => import('./editors/text/TextEditor')),
  pdf: lazy(() => import('./editors/pdf/PdfEditor')),
  docx: lazy(() => import('./editors/docx/DocxEditor')),
  pptx: lazy(() => import('./editors/pptx/PptxEditor')),
}
const PluginEditor = lazy(() => import('./plugins/PluginEditor'))
const editorFor = (kind: DocKind) => BUILT_IN_EDITORS[kind] ?? PluginEditor

const SettingsPanel = lazy(() => import('./components/Settings'))
const SetupScreen = lazy(() => import('./components/Setup'))

class EditorBoundary extends Component<{ name: string; children: ReactNode }, { error: Error | null }> {
  state = { error: null as Error | null }
  static getDerivedStateFromError(error: Error) {
    return { error }
  }
  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error(error, info.componentStack)
  }
  render() {
    if (!this.state.error) return this.props.children
    return (
      <CenterState title={`Couldn’t open “${this.props.name}”`}>
        <p className="muted">The file may be damaged or use features Workspace can’t read yet.</p>
        <code className="faint mono" style={{ fontSize: 12, userSelect: 'text' }}>
          {this.state.error.message}
        </code>
      </CenterState>
    )
  }
}

/**
 * One tab's editor. Memoized so switching tabs only re-renders the two tabs involved.
 * A tab's editor loads the first time the tab is shown: tabs restored from the last session or
 * opened in the background cost nothing (a large document can take hundreds of MB in WebKit)
 * until you look at them. After that it stays loaded, so switching back is instant.
 */
const EditorSlot = memo(function EditorSlot({ tab, active, pane }: EditorProps & { pane?: 'left' | 'right' }) {
  const Editor = editorFor(tab.kind)
  const visible = !!pane && !active
  const [shown, setShown] = useState(active || visible)
  if ((active || visible) && !shown) setShown(true)
  return (
    <div
      className="view"
      data-active={active || visible}
      data-pane={pane}
      data-focused={pane ? active : undefined}
      inert={!active && !visible}
      // In split view, using the other pane moves the focus (and the commands) to it.
      onPointerDownCapture={visible ? () => useWorkspace.getState().activate(tab.id) : undefined}
      onFocusCapture={visible ? () => useWorkspace.getState().activate(tab.id) : undefined}
    >
      {shown && (
        <EditorBoundary key={tab.loadId} name={tab.title}>
          <Suspense fallback={<CenterState spinner />}>
            <Editor key={tab.loadId} tab={tab} active={active} visible={visible} />
          </Suspense>
        </EditorBoundary>
      )}
    </div>
  )
})

/** The line between split view's panes; drag to resize, double-click for half and half. */
function SplitDivider() {
  const ratio = useWorkspace((s) => s.splitRatio)
  return (
    <div
      className="split-divider"
      style={{ left: `${ratio * 100}%` }}
      onDoubleClick={() => useWorkspace.getState().setSplitRatio(0.5)}
      onPointerDown={(e) => {
        e.preventDefault()
        const el = e.currentTarget
        const box = el.parentElement!.getBoundingClientRect()
        el.setPointerCapture(e.pointerId)
        el.classList.add('dragging')
        const move = (ev: PointerEvent) => useWorkspace.getState().setSplitRatio((ev.clientX - box.left) / box.width)
        const up = () => {
          el.classList.remove('dragging')
          el.removeEventListener('pointermove', move)
          el.removeEventListener('pointerup', up)
        }
        el.addEventListener('pointermove', move)
        el.addEventListener('pointerup', up)
      }}
    />
  )
}

/** ⇧⌘\: split with the tab to the right (or left), or a copy of this one; again to go back to one pane. */
async function toggleSplit() {
  const ws = useWorkspace.getState()
  if (ws.split) return ws.splitWith(null)
  const i = ws.tabs.findIndex((t) => t.id === ws.activeId)
  if (i === -1) return
  const neighbour = ws.tabs[i + 1] ?? ws.tabs[i - 1]
  await ws.splitWith(neighbour?.id ?? ws.activeId)
}

export async function runCommand(id: string) {
  const ws = useWorkspace.getState()
  const editor = getEditor(ws.activeId)
  switch (id) {
    case 'new-tab':
      ws.activate(HOME_TAB_ID)
      break
    case 'new':
      useNewFile.getState().setOpen(true)
      break
    case 'open':
      await ws.openDialog()
      break
    case 'open-folder':
      await chooseFolder()
      break
    case 'toggle-explorer':
      if (useFolder.getState().root) useFolder.getState().toggleVisible()
      else await runCommand('open-folder')
      break
    case 'close-folder':
      useFolder.getState().close()
      break
    case 'save':
      await ws.save()
      break
    case 'save-as':
      await ws.save(undefined, { saveAs: true })
      break
    case 'revert':
      await ws.revert()
      break
    case 'print':
      await editor?.print?.()
      break
    case 'version-history':
      showVersionHistory()
      break
    case 'reveal': {
      const tab = ws.tabs.find((t) => t.id === ws.activeId)
      if (tab?.path) await platform.revealInFinder(tab.path)
      break
    }
    case 'close-tab':
      await ws.closeTab()
      break
    case 'duplicate-tab':
      await ws.duplicateTab()
      break
    case 'reopen-tab':
      await ws.reopenClosed()
      break
    case 'find':
      editor?.find?.()
      break
    case 'split-view':
      await toggleSplit()
      break
    case 'toggle-left':
      ws.toggleLeft()
      break
    case 'toggle-right':
      ws.toggleRight()
      break
    case 'zoom-in':
      editor?.zoom?.('in')
      break
    case 'zoom-out':
      editor?.zoom?.('out')
      break
    case 'zoom-reset':
      editor?.zoom?.('reset')
      break
    case 'view-read':
      editor?.viewMode?.('read')
      break
    case 'view-split':
      editor?.viewMode?.('split')
      break
    case 'view-write':
      editor?.viewMode?.('write')
      break
    case 'view-cycle':
      editor?.viewMode?.('cycle')
      break
    case 'focus-mode':
      useFocus.getState().toggle()
      break
    case 'typewriter':
      useFocus.getState().toggleTypewriter()
      break
    case 'focus-dim':
      useFocus.getState().toggleDim()
      break
    case 'toggle-fullscreen':
      await platform.toggleFullscreen()
      break
    case 'settings':
      useSettings.getState().setOpen(true)
      break
    case 'command-palette':
      usePalette.getState().setOpen(!usePalette.getState().open)
      break
    case 'install-cli':
      try {
        if (await platform.setCliInstalled(true)) {
          await platform.showMessage('Type workspace . in Terminal to open the folder you’re in, or workspace and a file’s name to open it.', 'The workspace command is installed')
        }
      } catch (err) {
        await platform.showError(String(err), 'Couldn’t install the command')
      }
      break
    case 'toggle-theme':
      ws.setTheme(ws.theme === 'dark' ? 'light' : 'dark')
      break
    case 'next-tab':
      ws.activateOffset(1)
      break
    case 'prev-tab':
      ws.activateOffset(-1)
      break
    case 'quit':
      if (await confirmDiscardAll()) {
        await installUpdate({ restart: false })
        await platform.quitApp()
      }
      break
    case 'check-updates':
      openUpdatePanel()
      break
    case 'install-update':
      if (await confirmDiscardAll()) {
        await installUpdate({ restart: true })
        // Still here, so the install failed: keep saving the session.
        sessionFrozen = false
      }
      break
  }
}

/** Walk through unsaved tabs (like macOS “Review Changes”). Returns false if the user cancels. */
async function confirmDiscardAll(): Promise<boolean> {
  persistSession()
  sessionFrozen = true
  // Autosaved tabs just save; only the rest need asking about.
  await flushAutosave()
  for (const tab of useWorkspace.getState().tabs.filter((t) => t.dirty)) {
    useWorkspace.getState().activate(tab.id)
    const choice = await platform.askSaveChanges(tab.title)
    if (choice === 'cancel' || (choice === 'save' && !(await useWorkspace.getState().save(tab.id)))) {
      sessionFrozen = false
      return false
    }
  }
  return true
}

let sessionFrozen = false

/** Whether a command does anything right now, for the command palette. */
export function commandAvailable(command: string) {
  const ws = useWorkspace.getState()
  const tab = ws.tabs.find((t) => t.id === ws.activeId)
  if (!editorHandles(command)) return false
  switch (command) {
    case 'save':
    case 'save-as':
    case 'close-tab':
    case 'duplicate-tab':
      return !!tab
    case 'revert':
    case 'reveal':
      return !!tab?.path && !tab.path.startsWith('browser:')
    case 'reopen-tab':
      return ws.closedPaths.length > 0
    case 'toggle-left':
    case 'toggle-right':
      return !!tab
    case 'install-update':
      return false
  }
  return true
}

/** Commands that only mean something in some editors; elsewhere the key goes to the document (Ctrl+E centers text in Word). */
export function editorHandles(command: string) {
  const editor = getEditor(useWorkspace.getState().activeId)
  if (command.startsWith('view-')) return !!editor?.viewMode
  if (command.startsWith('zoom-')) return !!editor?.zoom
  // A plugin without its own find or print keeps the keys for itself (Excalidraw searches the canvas).
  if (command === 'find') return !!editor?.find
  if (command === 'print') return !!editor?.print
  return true
}

export default function App() {
  const tabs = useWorkspace((s) => s.tabs)
  const activeId = useWorkspace((s) => s.activeId)
  const split = useWorkspace((s) => s.split)
  const splitRatio = useWorkspace((s) => s.splitRatio)
  const dropHover = useWorkspace((s) => s.dropHover)
  const settingsOpen = useSettings((s) => s.open)
  const setupOpen = useSetup((s) => s.open)
  const newFileOpen = useNewFile((s) => s.open)
  const paletteOpen = usePalette((s) => s.open)
  const historyOpen = useVersionHistory((s) => !!s.tabId)
  const texOffer = useTex((s) => s.offer)
  const texRemoval = useTex((s) => !!s.removal)
  const focus = useFocus((s) => s.on)
  const dim = useFocus(dimming)
  const typewriter = useFocus((s) => s.typewriter)
  const explorer = useFolder((s) => !!s.root && s.visible)
  const started = useRef(false)

  // Startup: restore last session, then open anything Finder handed us.
  useEffect(() => {
    const unlisteners: Promise<() => void>[] = []
    const drainPending = async () => {
      const paths = await platform.takePendingOpens()
      if (paths.length) await useWorkspace.getState().openPaths(paths)
    }
    if (!started.current) {
      started.current = true
      void (async () => {
        // Plugins (and downloaded fonts) first: a restored tab may need one.
        await Promise.all([startPlugins(), useExtraFonts.getState().refresh()])
        await restoreSession()
        await drainPending()
      })()
    }
    unlisteners.push(platform.listen<string>('menu', (id) => void runCommand(id)))
    unlisteners.push(platform.listen('open-requested', () => void drainPending()))
    unlisteners.push(
      platform.onFileDrop(
        (paths) => void useWorkspace.getState().openPaths(paths),
        (on) => useWorkspace.getState().setDropHover(on),
      ),
    )
    unlisteners.push(
      platform.onCloseRequested(async () => {
        if (!(await confirmDiscardAll())) return false
        await installUpdate({ restart: false })
        return true
      }),
    )
    // Shortcuts changed in Settings: the menu is built with the defaults.
    void syncMenu()
    const stopUpdateChecks = startUpdateChecks()
    const stopAutosave = startAutosave()
    return () => {
      stopUpdateChecks()
      stopAutosave()
      unlisteners.forEach((u) => void u.then((fn) => fn()))
    }
  }, [])

  // Keep the session snapshot current.
  useEffect(() => {
    if (!sessionFrozen) persistSession()
  }, [tabs, activeId])

  // Keyboard: ⌘1–⌘9 everywhere; app shortcuts the Mac menu bar would handle, on Windows and in a
  // browser; and editor shortcuts (see state/shortcuts.ts, which Settings can change).
  // Capture phase, so an editor that swallows keys can't eat Save or Close Tab.
  useEffect(() => {
    const menuOwnsShortcuts = platform.isTauri && platform.isMac
    const onKey = (e: KeyboardEvent) => {
      if (useSettings.getState().open || useSetup.getState().open || useNewFile.getState().open || useVersionHistory.getState().tabId) return
      // The palette answers its own keys; its shortcut still closes it.
      if (usePalette.getState().open && keysFromEvent(e) !== keysFor('command-palette')) return
      const mod = platform.isMac ? e.metaKey : e.ctrlKey
      if (mod && (platform.isMac || !e.metaKey) && /^Digit[1-9]$/.test(e.code) && !e.shiftKey && !e.altKey) {
        e.preventDefault()
        useWorkspace.getState().activateIndex(Number(e.code.slice(5)) - 1)
        return
      }
      const keys = keysFromEvent(e)
      if (!keys) return
      const ws = useWorkspace.getState()
      const kind = ws.tabs.find((t) => t.id === ws.activeId)?.kind
      const scope: Scope | null = kind === 'docx' || kind === 'pptx' ? kind : null
      const def = shortcutFor(keys, scope)
      const stop = () => {
        e.preventDefault()
        e.stopPropagation()
      }
      if (def?.scope === 'app') {
        if (menuOwnsShortcuts || !editorHandles(def.id)) return
        stop()
        void runCommand(def.id)
        return
      }
      // Editor shortcuts are for the document, not a field beside it (speaker notes, a comment box).
      if (e.target instanceof HTMLElement && e.target.closest('input, textarea, select')) return
      const editor = getEditor(ws.activeId)
      // An engine shortcut still on its own keys: the engine does it.
      if (def && !(def.builtIn && def.keys === keys)) {
        const action = editor?.actions?.[def.id]
        if (action && action() !== false) stop()
        return
      }
      // An engine shortcut moved to other keys: its old ones do nothing now.
      if (!def && movedBuiltIn(keys, scope)) stop()
    }
    window.addEventListener('keydown', onKey, true)
    return () => window.removeEventListener('keydown', onKey, true)
  }, [])

  // Browser-only drag & drop (inside the app, Tauri delivers dropped paths natively).
  useEffect(() => {
    if (platform.isTauri) return
    const over = (e: DragEvent) => {
      if (e.dataTransfer?.types.includes('Files')) {
        e.preventDefault()
        useWorkspace.getState().setDropHover(true)
      }
    }
    const leave = (e: DragEvent) => {
      if (!e.relatedTarget) useWorkspace.getState().setDropHover(false)
    }
    const drop = async (e: DragEvent) => {
      if (!e.dataTransfer?.files.length) return
      e.preventDefault()
      useWorkspace.getState().setDropHover(false)
      const files = await Promise.all(Array.from(e.dataTransfer.files).map(platform.fileToOpened))
      useWorkspace.getState().openFiles(files)
    }
    window.addEventListener('dragover', over)
    window.addEventListener('dragleave', leave)
    window.addEventListener('drop', drop)
    return () => {
      window.removeEventListener('dragover', over)
      window.removeEventListener('dragleave', leave)
      window.removeEventListener('drop', drop)
    }
  }, [])

  return (
    <div className="app" data-focus={focus || undefined} data-focus-dim={dim || undefined} data-typewriter={typewriter || undefined}>
      <TitleBar />
      <div className="app-body">
        {explorer && <Explorer />}
        <div className="views" data-split={split ? '' : undefined} style={split ? ({ '--split': `${splitRatio * 100}%` } as React.CSSProperties) : undefined}>
          <div className="view" data-active={activeId === HOME_TAB_ID} inert={activeId !== HOME_TAB_ID}>
            <Home />
          </div>
          {tabs.map((tab) => (
            <EditorSlot key={tab.id} tab={tab} active={tab.id === activeId} pane={split?.[0] === tab.id ? 'left' : split?.[1] === tab.id ? 'right' : undefined} />
          ))}
          {split && <SplitDivider />}
        </div>
      </div>
      {settingsOpen && (
        <Suspense fallback={null}>
          <SettingsPanel />
        </Suspense>
      )}
      {newFileOpen && <NewFilePicker />}
      {paletteOpen && <CommandPalette />}
      {historyOpen && <VersionHistory />}
      {setupOpen && (
        <Suspense fallback={null}>
          <SetupScreen />
        </Suspense>
      )}
      {texOffer && <TexInstall />}
      {texRemoval && <TexRemove />}
      <FocusMode />
      <Dialogs />
      {dropHover && (
        <div className="drop-overlay">
          <div className="pill">Drop to open</div>
        </div>
      )}
    </div>
  )
}

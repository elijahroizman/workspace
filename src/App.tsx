import { Component, lazy, Suspense, useEffect, useRef } from 'react'
import type { ComponentType, ErrorInfo, ReactNode } from 'react'
import { Home } from './components/Home'
import { TitleBar } from './components/TitleBar'
import { CenterState } from './components/ui'
import type { DocKind } from './lib/kinds'
import * as platform from './lib/platform'
import type { DocTab } from './state/workspace'
import { getEditor, HOME_TAB_ID, persistSession, restoreSession, useWorkspace } from './state/workspace'

export interface EditorProps {
  tab: DocTab
  active: boolean
}

// Each editor (and its heavy engine) loads only when a tab of that type opens,
// which keeps launch fast.
const EDITORS: Record<DocKind, React.LazyExoticComponent<ComponentType<EditorProps>>> = {
  md: lazy(() => import('./editors/markdown/MarkdownEditor')),
  pdf: lazy(() => import('./editors/pdf/PdfEditor')),
  docx: lazy(() => import('./editors/docx/DocxEditor')),
  pptx: lazy(() => import('./editors/pptx/PptxEditor')),
}

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

export async function runCommand(id: string) {
  const ws = useWorkspace.getState()
  const editor = getEditor(ws.activeId)
  switch (id) {
    case 'new-tab':
      ws.activate(HOME_TAB_ID)
      break
    case 'new-docx':
      ws.newDocument('docx')
      break
    case 'new-pptx':
      ws.newDocument('pptx')
      break
    case 'new-md':
      ws.newDocument('md')
      break
    case 'open':
      await ws.openDialog()
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
    case 'reveal': {
      const tab = ws.tabs.find((t) => t.id === ws.activeId)
      if (tab?.path) await platform.revealInFinder(tab.path)
      break
    }
    case 'close-tab':
      await ws.closeTab()
      break
    case 'reopen-tab':
      await ws.reopenClosed()
      break
    case 'find':
      editor?.find?.()
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
      if (await confirmDiscardAll()) await platform.quitApp()
      break
  }
}

/** Walk through unsaved tabs (like macOS “Review Changes”). Returns false if the user cancels. */
async function confirmDiscardAll(): Promise<boolean> {
  persistSession()
  sessionFrozen = true
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

// Shortcuts the native menu bar owns inside the app; in a plain browser we handle them here.
const BROWSER_SHORTCUTS: Record<string, string> = {
  t: 'new-tab',
  n: 'new-docx',
  'shift+n': 'new-pptx',
  'alt+n': 'new-md',
  o: 'open',
  s: 'save',
  'shift+s': 'save-as',
  p: 'print',
  w: 'close-tab',
  'shift+t': 'reopen-tab',
  f: 'find',
  '\\': 'toggle-left',
  'alt+\\': 'toggle-right',
  '=': 'zoom-in',
  '-': 'zoom-out',
  '0': 'zoom-reset',
  'shift+l': 'toggle-theme',
  'shift+]': 'next-tab',
  'shift+[': 'prev-tab',
}

export default function App() {
  const tabs = useWorkspace((s) => s.tabs)
  const activeId = useWorkspace((s) => s.activeId)
  const theme = useWorkspace((s) => s.theme)
  const dropHover = useWorkspace((s) => s.dropHover)
  const started = useRef(false)

  useEffect(() => {
    document.documentElement.dataset.theme = theme
  }, [theme])

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
    unlisteners.push(platform.onCloseRequested(confirmDiscardAll))
    return () => unlisteners.forEach((u) => void u.then((fn) => fn()))
  }, [])

  // Keep the session snapshot current.
  useEffect(() => {
    if (!sessionFrozen) persistSession()
  }, [tabs, activeId])

  // Keyboard: ⌘1–⌘9 everywhere, plus everything the menu bar would handle when running in a browser.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const mod = platform.isMac ? e.metaKey : e.ctrlKey
      if (!mod) return
      if (/^[1-9]$/.test(e.key) && !e.shiftKey && !e.altKey) {
        e.preventDefault()
        useWorkspace.getState().activateIndex(Number(e.key) - 1)
        return
      }
      if (platform.isTauri) return
      const key = e.key === '+' ? '=' : e.key.length === 1 ? e.key.toLowerCase() : e.key
      const combo = `${e.shiftKey ? 'shift+' : ''}${e.altKey ? 'alt+' : ''}${e.code === 'Backslash' ? '\\' : e.code === 'BracketRight' ? ']' : e.code === 'BracketLeft' ? '[' : key}`
      const command = BROWSER_SHORTCUTS[combo]
      if (command) {
        e.preventDefault()
        void runCommand(command)
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
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
    <div className="app">
      <TitleBar />
      <div className="views">
        <div className="view" hidden={activeId !== HOME_TAB_ID}>
          <Home />
        </div>
        {tabs.map((tab) => {
          const Editor = EDITORS[tab.kind]
          const active = tab.id === activeId
          return (
            <div key={tab.id} className="view" hidden={!active}>
              <EditorBoundary key={tab.loadId} name={tab.title}>
                <Suspense fallback={<CenterState spinner />}>
                  <Editor key={tab.loadId} tab={tab} active={active} />
                </Suspense>
              </EditorBoundary>
            </div>
          )
        })}
      </div>
      {dropHover && (
        <div className="drop-overlay">
          <div className="pill">Drop to open</div>
        </div>
      )}
    </div>
  )
}

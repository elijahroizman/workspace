import { create } from 'zustand'
import type { DocKind } from '../lib/kinds'
import { KINDS, kindFromPath, stripExtension } from '../lib/kinds'
import * as platform from '../lib/platform'

export const HOME_TAB_ID = 'home'

export interface DocTab {
  id: string
  kind: DocKind
  title: string
  /** Where the file lives on disk; null until an untitled document is saved. */
  path: string | null
  /** Bytes to load into the editor; null means “start a blank document”. */
  bytes: Uint8Array | null
  /** Bumped to make the editor reload `bytes` (revert, external reload). */
  loadId: number
  dirty: boolean
}

export interface RecentFile {
  path: string
  kind: DocKind
  openedAt: number
}

/** What every editor exposes to the shell (save, find, zoom, print). */
export interface EditorHandle {
  getBytes(): Promise<Uint8Array>
  /** Called after a successful save so the editor can reset its own dirty state. */
  markSaved?(): void
  find?(): void
  zoom?(direction: 'in' | 'out' | 'reset'): void
  print?(): Promise<void>
  /** Markdown view mode: read, split, write, or cycle through them. */
  viewMode?(mode: 'read' | 'split' | 'write' | 'cycle'): void
}

const handles = new Map<string, EditorHandle>()
export const registerEditor = (tabId: string, handle: EditorHandle) => {
  handles.set(tabId, handle)
  return () => {
    if (handles.get(tabId) === handle) handles.delete(tabId)
  }
}
export const getEditor = (tabId: string) => handles.get(tabId)

/** Counts edits per tab, so a save can tell whether the document changed while it was writing. */
const edits = new Map<string, number>()

/** Autosave plugs in here (see lib/autosave.ts); until it does, nothing autosaves. */
export const autosaveHooks = {
  /** A tab's document just changed. */
  edited: (_tabId: string) => {},
  /** Save a tab now if autosave covers it. Resolves true once its changes are on disk. */
  flush: async (_tabId: string) => false,
}

type Theme = 'dark' | 'light'

interface WorkspaceState {
  tabs: DocTab[]
  activeId: string
  recents: RecentFile[]
  closedPaths: string[]
  theme: Theme
  leftOpen: Record<DocKind, boolean>
  rightOpen: Record<DocKind, boolean>
  dropHover: boolean

  activate(id: string): void
  activateOffset(delta: number): void
  activateIndex(index: number): void
  moveTab(id: string, toIndex: number): void
  openPaths(paths: string[]): Promise<void>
  openFiles(files: platform.OpenedFile[]): void
  openDialog(): Promise<void>
  newDocument(kind: DocKind): void
  markDirty(id: string, dirty: boolean): void
  /**
   * Save a tab. `to` saves to that path without asking. `quiet` throws on failure instead of
   * showing an error (autosave reports failures itself).
   */
  save(id?: string, opts?: { saveAs?: boolean; to?: string; quiet?: boolean }): Promise<boolean>
  revert(id?: string): Promise<void>
  closeTab(id?: string): Promise<boolean>
  closeAll(): Promise<boolean>
  reopenClosed(): Promise<void>
  /** Open a second, independent tab on the same file (e.g. a textbook's questions and answers side by side). */
  duplicateTab(id?: string): Promise<void>
  closeOthers(id: string): Promise<void>
  removeRecent(path: string): void
  toggleLeft(kind?: DocKind): void
  toggleRight(kind?: DocKind): void
  setTheme(theme: Theme): void
  setDropHover(on: boolean): void
}

const STORAGE = {
  recents: 'workspace.recents',
  session: 'workspace.session',
  theme: 'workspace.theme',
  panels: 'workspace.panels',
}

function load<T>(key: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(key)
    return raw ? (JSON.parse(raw) as T) : fallback
  } catch {
    return fallback
  }
}

const defaultPanels = {
  left: { docx: true, pptx: true, pdf: true, md: true, txt: false } as Record<DocKind, boolean>,
  // Markdown is mostly for reading, so its inspector starts hidden.
  right: { docx: true, pptx: true, pdf: true, md: false, txt: false } as Record<DocKind, boolean>,
}

const savedPanels = load<Partial<typeof defaultPanels>>(STORAGE.panels, {})
// Kinds added since the panels were last saved take their defaults.
const initialPanels = {
  left: { ...defaultPanels.left, ...savedPanels.left },
  right: { ...defaultPanels.right, ...savedPanels.right },
}
const systemTheme: Theme =
  typeof matchMedia !== 'undefined' && matchMedia('(prefers-color-scheme: light)').matches ? 'light' : 'dark'

const untitledCounters: Record<DocKind, number> = { docx: 0, pptx: 0, pdf: 0, md: 0, txt: 0 }
const newId = () => Math.random().toString(36).slice(2, 10)

export const useWorkspace = create<WorkspaceState>((set, get) => {
  const activeDoc = (id?: string) => {
    const tabId = id ?? get().activeId
    return get().tabs.find((t) => t.id === tabId)
  }

  const addRecent = (path: string, kind: DocKind) => {
    if (path.startsWith('browser:')) return
    const recents = [{ path, kind, openedAt: Date.now() }, ...get().recents.filter((r) => r.path !== path)].slice(0, 30)
    set({ recents })
    localStorage.setItem(STORAGE.recents, JSON.stringify(recents))
  }

  const addTab = (tab: DocTab) => {
    const { tabs, activeId } = get()
    // Open next to the current tab, like a browser.
    const at = tabs.findIndex((t) => t.id === activeId)
    const next = [...tabs]
    next.splice(at === -1 ? tabs.length : at + 1, 0, tab)
    set({ tabs: next, activeId: tab.id })
  }

  return {
    tabs: [],
    activeId: HOME_TAB_ID,
    recents: load<RecentFile[]>(STORAGE.recents, []),
    closedPaths: [],
    theme: load<Theme>(STORAGE.theme, systemTheme),
    leftOpen: initialPanels.left,
    rightOpen: initialPanels.right,
    dropHover: false,

    activate: (id) => set({ activeId: id }),

    activateOffset: (delta) => {
      const ids = [HOME_TAB_ID, ...get().tabs.map((t) => t.id)]
      const i = ids.indexOf(get().activeId)
      set({ activeId: ids[(i + delta + ids.length) % ids.length] })
    },

    activateIndex: (index) => {
      const ids = [HOME_TAB_ID, ...get().tabs.map((t) => t.id)]
      // ⌘9 always jumps to the last tab, as in Safari.
      const id = index >= 8 ? ids[ids.length - 1] : ids[index]
      if (id) set({ activeId: id })
    },

    moveTab: (id, toIndex) => {
      const tabs = [...get().tabs]
      const from = tabs.findIndex((t) => t.id === id)
      if (from === -1) return
      const [tab] = tabs.splice(from, 1)
      tabs.splice(Math.max(0, Math.min(toIndex, tabs.length)), 0, tab)
      set({ tabs })
    },

    openPaths: async (paths) => {
      const failures: string[] = []
      const opened: DocTab[] = []
      for (const path of paths) {
        const existing = get().tabs.find((t) => t.path === path)
        if (existing) {
          set({ activeId: existing.id })
          continue
        }
        const kind = kindFromPath(path)
        if (!kind) {
          failures.push(`“${platform.basename(path)}” isn't a file type Workspace opens (Word, PowerPoint, PDF, Markdown or plain text).`)
          continue
        }
        if (opened.some((t) => t.path === path)) continue
        try {
          const bytes = await platform.readFile(path)
          opened.push({ id: newId(), kind, title: stripExtension(platform.basename(path)), path, bytes, loadId: 0, dirty: false })
        } catch (err) {
          failures.push(String(err))
          if (!(await platform.pathExists(path))) get().removeRecent(path)
        }
      }
      // Add them in one go, so only the last one is shown. The others load when first opened
      // (see EditorSlot), which keeps a restored session from loading every document at launch.
      for (const tab of opened) {
        addTab(tab)
        addRecent(tab.path!, tab.kind)
      }
      if (failures.length) void platform.showError(failures.join('\n\n'))
    },

    openFiles: (files) => {
      for (const file of files) {
        const kind = kindFromPath(file.name)
        if (!kind) continue
        const existing = get().tabs.find((t) => t.path === file.path)
        if (existing) {
          set({ activeId: existing.id })
          continue
        }
        addTab({ id: newId(), kind, title: stripExtension(file.name), path: file.path, bytes: file.bytes, loadId: 0, dirty: false })
        addRecent(file.path, kind)
      }
    },

    openDialog: async () => {
      const files = await platform.pickFiles()
      get().openFiles(files)
    },

    newDocument: (kind) => {
      const n = ++untitledCounters[kind]
      const title = n === 1 ? KINDS[kind].untitled : `${KINDS[kind].untitled} ${n}`
      addTab({ id: newId(), kind, title, path: null, bytes: null, loadId: 0, dirty: false })
    },

    markDirty: (id, dirty) => {
      const tab = get().tabs.find((t) => t.id === id)
      if (!tab) return
      if (tab.dirty !== dirty) set({ tabs: get().tabs.map((t) => (t.id === id ? { ...t, dirty } : t)) })
      if (dirty) {
        edits.set(id, (edits.get(id) ?? 0) + 1)
        autosaveHooks.edited(id)
      }
    },

    save: async (id, opts) => {
      const tab = activeDoc(id)
      if (!tab) return false
      const editor = getEditor(tab.id)
      if (!editor) return false
      let path = opts?.to ?? tab.path
      if (!path || opts?.saveAs) {
        path = await platform.pickSavePath(tab.title, tab.kind)
        if (!path) return false
      }
      const editsBefore = edits.get(tab.id) ?? 0
      try {
        const bytes = await editor.getBytes()
        await platform.writeFile(path, bytes)
        editor.markSaved?.()
        const title = stripExtension(platform.basename(path))
        // An edit made while the file was being written isn't in it, so the tab stays unsaved.
        const dirty = (edits.get(tab.id) ?? 0) !== editsBefore
        set({ tabs: get().tabs.map((t) => (t.id === tab.id ? { ...t, path, title, dirty } : t)) })
        addRecent(path, tab.kind)
        return true
      } catch (err) {
        if (opts?.quiet) throw err
        await platform.showError(String(err))
        return false
      }
    },

    revert: async (id) => {
      const tab = activeDoc(id)
      if (!tab?.path) return
      if (tab.dirty) {
        const ok = await platform.confirmDialog(`Revert “${tab.title}” to the last saved version? Your unsaved changes will be lost.`, {
          okLabel: 'Revert',
        })
        if (!ok) return
      }
      try {
        const bytes = await platform.readFile(tab.path)
        set({
          tabs: get().tabs.map((t) => (t.id === tab.id ? { ...t, bytes, loadId: t.loadId + 1, dirty: false } : t)),
        })
      } catch (err) {
        await platform.showError(String(err))
      }
    },

    closeTab: async (id) => {
      const tabId = id ?? get().activeId
      if (tabId === HOME_TAB_ID) return true
      const tab = get().tabs.find((t) => t.id === tabId)
      if (!tab) return true
      // Autosaved tabs close without asking once their last changes are written.
      if (tab.dirty && !(await autosaveHooks.flush(tab.id))) {
        set({ activeId: tab.id })
        const choice = await platform.askSaveChanges(tab.title)
        if (choice === 'cancel') return false
        if (choice === 'save' && !(await get().save(tab.id))) return false
      }
      const { tabs, activeId } = get()
      const index = tabs.findIndex((t) => t.id === tabId)
      const remaining = tabs.filter((t) => t.id !== tabId)
      let nextActive = activeId
      if (activeId === tabId) {
        const neighbour = remaining[index] ?? remaining[index - 1]
        nextActive = neighbour?.id ?? HOME_TAB_ID
      }
      // Save from the close prompt may have just given an untitled document a path.
      const path = get().tabs.find((t) => t.id === tabId)?.path ?? tab.path
      const closedPaths = path ? [...get().closedPaths, path].slice(-20) : get().closedPaths
      edits.delete(tabId)
      set({ tabs: remaining, activeId: nextActive, closedPaths })
      return true
    },

    closeAll: async () => {
      for (const tab of [...get().tabs]) {
        if (!(await get().closeTab(tab.id))) return false
      }
      return true
    },

    duplicateTab: async (id) => {
      const tab = activeDoc(id)
      if (!tab) return
      try {
        // Unsaved edits come along (and the copy starts out unsaved too); otherwise read the file fresh.
        const fromEditor = tab.dirty || !tab.path || tab.path.startsWith('browser:')
        const bytes = fromEditor ? ((await getEditor(tab.id)?.getBytes()) ?? tab.bytes) : await platform.readFile(tab.path!)
        const base = tab.title.replace(/ \(\d+\)$/, '')
        const copies = get().tabs.filter((t) => t.path === tab.path && t.path !== null).length
        addTab({ ...tab, id: newId(), title: tab.path ? `${base} (${copies + 1})` : `${base} copy`, bytes, loadId: 0, dirty: tab.dirty })
      } catch (err) {
        await platform.showError(String(err))
      }
    },

    closeOthers: async (id) => {
      for (const tab of get().tabs.filter((t) => t.id !== id)) {
        if (!(await get().closeTab(tab.id))) return
      }
      set({ activeId: id })
    },

    reopenClosed: async () => {
      const closedPaths = [...get().closedPaths]
      const path = closedPaths.pop()
      set({ closedPaths })
      if (path) await get().openPaths([path])
    },

    removeRecent: (path) => {
      const recents = get().recents.filter((r) => r.path !== path)
      set({ recents })
      localStorage.setItem(STORAGE.recents, JSON.stringify(recents))
    },

    toggleLeft: (kind) => {
      const k = kind ?? activeDoc()?.kind
      if (!k) return
      set({ leftOpen: { ...get().leftOpen, [k]: !get().leftOpen[k] } })
      persistPanels()
    },

    toggleRight: (kind) => {
      const k = kind ?? activeDoc()?.kind
      if (!k) return
      set({ rightOpen: { ...get().rightOpen, [k]: !get().rightOpen[k] } })
      persistPanels()
    },

    setTheme: (theme) => {
      set({ theme })
      localStorage.setItem(STORAGE.theme, JSON.stringify(theme))
    },

    setDropHover: (dropHover) => set({ dropHover }),
  }
})

function persistPanels() {
  const { leftOpen, rightOpen } = useWorkspace.getState()
  localStorage.setItem(STORAGE.panels, JSON.stringify({ left: leftOpen, right: rightOpen }))
}

// Read once at startup, before anything can overwrite it.
const initialSession = load<{ paths: string[]; active: string | null }>(STORAGE.session, { paths: [], active: null })
let sessionRestored = false

/** Remember which files were open so the next launch picks up where you left off. */
export function persistSession() {
  if (!sessionRestored) return
  const { tabs, activeId } = useWorkspace.getState()
  const paths = tabs.filter((t) => t.path && !t.path.startsWith('browser:')).map((t) => t.path as string)
  const active = tabs.find((t) => t.id === activeId)?.path ?? null
  localStorage.setItem(STORAGE.session, JSON.stringify({ paths, active }))
}

export async function restoreSession() {
  try {
    await reopen(initialSession)
  } finally {
    sessionRestored = true
    persistSession()
  }
}

async function reopen(session: { paths: string[]; active: string | null }) {
  if (!session.paths.length) return
  const existing = []
  for (const path of session.paths) if (await platform.pathExists(path)) existing.push(path)
  const { openPaths } = useWorkspace.getState()
  // Open in order without moving focus around, then focus the tab that was active.
  useWorkspace.setState({ activeId: HOME_TAB_ID })
  await openPaths(existing)
  const state = useWorkspace.getState()
  const active = state.tabs.find((t) => t.path === session.active)
  useWorkspace.setState({ activeId: active?.id ?? HOME_TAB_ID })
}

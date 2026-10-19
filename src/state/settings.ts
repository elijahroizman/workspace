import { create } from 'zustand'

export interface AutosaveSettings {
  /** When false, nothing autosaves. Files still save with the Save command. */
  enabled: boolean
  /** Seconds to wait after the last edit before saving. */
  delay: number
  /** By kind id. A kind not listed here (a plugin's) autosaves. */
  kinds: Record<string, boolean>
}

export interface Settings {
  autosave: AutosaveSettings
  /** Seconds after typing stops before a slow preview (a LaTeX compile) rebuilds. */
  previewDelay: number
  /** By kind id: whether Home's Recent list has a tab for it. Every file is still under All. */
  recentTabs: Record<string, boolean>
  /** Keep a copy of each saved version (see src-tauri/src/history.rs). */
  history: boolean
}

export const DEFAULT_SETTINGS: Settings = {
  autosave: {
    enabled: true,
    delay: 3,
    kinds: {},
  },
  previewDelay: 3,
  recentTabs: {},
  history: true,
}

const KEY = 'workspace.settings'
/**
 * Stored with the settings. Before 2, PDFs started with autosave off, so a stored `pdf: false`
 * was almost always that default rather than a choice; version 1 settings drop it.
 */
const VERSION = 2

/** The delays Settings offers. Anything else in storage is ignored. */
const DELAYS = [1, 3, 10, 30]
export const PREVIEW_DELAYS = [1, 2, 3, 5, 10]

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function load(): Settings {
  try {
    const parsed: unknown = JSON.parse(localStorage.getItem(KEY) || '{}')
    if (!isRecord(parsed)) return DEFAULT_SETTINGS
    const previewDelay = typeof parsed.previewDelay === 'number' && PREVIEW_DELAYS.includes(parsed.previewDelay) ? parsed.previewDelay : DEFAULT_SETTINGS.previewDelay
    const recentTabs: Record<string, boolean> = {}
    if (isRecord(parsed.recentTabs)) {
      for (const [kind, on] of Object.entries(parsed.recentTabs)) if (typeof on === 'boolean') recentTabs[kind] = on
    }
    const history = typeof parsed.history === 'boolean' ? parsed.history : DEFAULT_SETTINGS.history
    if (!isRecord(parsed.autosave)) return { ...DEFAULT_SETTINGS, previewDelay, recentTabs, history }
    const old = parsed.autosave
    const defaults = DEFAULT_SETTINGS.autosave
    const kinds = { ...defaults.kinds }
    if (isRecord(old.kinds)) {
      for (const kind of Object.keys(old.kinds)) {
        if (typeof old.kinds[kind] === 'boolean') kinds[kind] = old.kinds[kind]
      }
    }
    if (parsed.version !== VERSION && kinds.pdf === false) delete kinds.pdf
    const delay = typeof old.delay === 'number' && DELAYS.includes(old.delay) ? old.delay : defaults.delay
    // A build from before `enabled` stored the choice as whether a folder was picked.
    let enabled = defaults.enabled
    if (typeof old.enabled === 'boolean') enabled = old.enabled
    else if ('root' in old) enabled = typeof old.root === 'string' && old.root.length > 0
    return { autosave: { enabled, delay, kinds }, previewDelay, recentTabs, history }
  } catch {
    return DEFAULT_SETTINGS
  }
}

export type SettingsPage = 'general' | 'plugins' | 'autosave' | 'appearance' | 'shortcuts' | 'licenses'

interface SettingsState extends Settings {
  /** Whether the Settings window is showing. */
  open: boolean
  /** The page it shows. */
  page: SettingsPage
  setOpen(open: boolean, page?: SettingsPage): void
  setPage(page: SettingsPage): void
  setAutosave(patch: Partial<AutosaveSettings>): void
  setPreviewDelay(seconds: number): void
  setRecentTab(kind: string, on: boolean): void
  setHistory(on: boolean): void
}

const persist = () => {
  const { autosave, previewDelay, recentTabs, history } = useSettings.getState()
  localStorage.setItem(KEY, JSON.stringify({ version: VERSION, autosave, previewDelay, recentTabs, history } satisfies Settings & { version: number }))
}

export const useSettings = create<SettingsState>((set, get) => ({
  ...load(),
  open: false,
  page: 'general',
  // Settings always opens on General, wherever it was left.
  setOpen: (open, page) => set(open ? { open, page: page ?? 'general' } : { open }),
  setPage: (page) => set({ page }),
  setAutosave: (patch) => {
    set({ autosave: { ...get().autosave, ...patch } })
    persist()
  },
  setPreviewDelay: (previewDelay) => {
    set({ previewDelay })
    persist()
  },
  setRecentTab: (kind, on) => {
    set({ recentTabs: { ...get().recentTabs, [kind]: on } })
    persist()
  },
  setHistory: (history) => {
    set({ history })
    persist()
  },
}))

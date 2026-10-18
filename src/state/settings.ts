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
}

export const DEFAULT_SETTINGS: Settings = {
  autosave: {
    enabled: true,
    delay: 3,
    // Saving a PDF rewrites the whole file, so PDFs wait for the Save command unless you opt in.
    kinds: { docx: true, pptx: true, md: true, txt: true, pdf: false },
  },
  previewDelay: 3,
}

const KEY = 'workspace.settings'

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
    if (!isRecord(parsed.autosave)) return { ...DEFAULT_SETTINGS, previewDelay }
    const old = parsed.autosave
    const defaults = DEFAULT_SETTINGS.autosave
    const kinds = { ...defaults.kinds }
    if (isRecord(old.kinds)) {
      for (const kind of Object.keys(old.kinds)) {
        if (typeof old.kinds[kind] === 'boolean') kinds[kind] = old.kinds[kind]
      }
    }
    const delay = typeof old.delay === 'number' && DELAYS.includes(old.delay) ? old.delay : defaults.delay
    // A build from before `enabled` stored the choice as whether a folder was picked.
    let enabled = defaults.enabled
    if (typeof old.enabled === 'boolean') enabled = old.enabled
    else if ('root' in old) enabled = typeof old.root === 'string' && old.root.length > 0
    return { autosave: { enabled, delay, kinds }, previewDelay }
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
}

const persist = () => {
  const { autosave, previewDelay } = useSettings.getState()
  localStorage.setItem(KEY, JSON.stringify({ autosave, previewDelay } satisfies Settings))
}

export const useSettings = create<SettingsState>((set, get) => ({
  ...load(),
  open: false,
  page: 'general',
  setOpen: (open, page) => set(page ? { open, page } : { open }),
  setPage: (page) => set({ page }),
  setAutosave: (patch) => {
    set({ autosave: { ...get().autosave, ...patch } })
    persist()
  },
  setPreviewDelay: (previewDelay) => {
    set({ previewDelay })
    persist()
  },
}))

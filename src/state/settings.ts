import { create } from 'zustand'
import type { DocKind } from '../lib/kinds'

export interface AutosaveSettings {
  /** When false, nothing autosaves. Files still save with the Save command. */
  enabled: boolean
  /** Seconds to wait after the last edit before saving. */
  delay: number
  kinds: Record<DocKind, boolean>
}

export interface Settings {
  autosave: AutosaveSettings
}

export const DEFAULT_SETTINGS: Settings = {
  autosave: {
    enabled: true,
    delay: 3,
    // Saving a PDF rewrites the whole file, so PDFs wait for the Save command unless you opt in.
    kinds: { docx: true, pptx: true, md: true, txt: true, pdf: false },
  },
}

const KEY = 'workspace.settings'

/** The delays Settings offers. Anything else in storage is ignored. */
const DELAYS = [1, 3, 10, 30]

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function load(): Settings {
  try {
    const parsed: unknown = JSON.parse(localStorage.getItem(KEY) || '{}')
    if (!isRecord(parsed) || !isRecord(parsed.autosave)) return DEFAULT_SETTINGS
    const old = parsed.autosave
    const defaults = DEFAULT_SETTINGS.autosave
    const kinds = { ...defaults.kinds }
    if (isRecord(old.kinds)) {
      for (const kind of Object.keys(kinds) as DocKind[]) {
        if (typeof old.kinds[kind] === 'boolean') kinds[kind] = old.kinds[kind]
      }
    }
    const delay = typeof old.delay === 'number' && DELAYS.includes(old.delay) ? old.delay : defaults.delay
    // A build from before `enabled` stored the choice as whether a folder was picked.
    let enabled = defaults.enabled
    if (typeof old.enabled === 'boolean') enabled = old.enabled
    else if ('root' in old) enabled = typeof old.root === 'string' && old.root.length > 0
    return { autosave: { enabled, delay, kinds } }
  } catch {
    return DEFAULT_SETTINGS
  }
}

interface SettingsState extends Settings {
  /** Whether the Settings window is showing. */
  open: boolean
  setOpen(open: boolean): void
  setAutosave(patch: Partial<AutosaveSettings>): void
}

export const useSettings = create<SettingsState>((set, get) => ({
  ...load(),
  open: false,
  setOpen: (open) => set({ open }),
  setAutosave: (patch) => {
    set({ autosave: { ...get().autosave, ...patch } })
    const { autosave } = get()
    localStorage.setItem(KEY, JSON.stringify({ autosave } satisfies Settings))
  },
}))

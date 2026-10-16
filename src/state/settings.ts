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

/** Older builds stored one cloud folder. No folder meant autosave was off. */
interface LegacyAutosave extends Partial<AutosaveSettings> {
  root?: string | null
}

function load(): Settings {
  try {
    const saved = JSON.parse(localStorage.getItem(KEY) || '{}') as { autosave?: LegacyAutosave }
    const old = saved.autosave
    const merged: AutosaveSettings = {
      ...DEFAULT_SETTINGS.autosave,
      ...old,
      kinds: { ...DEFAULT_SETTINGS.autosave.kinds, ...old?.kinds },
    }
    // A build from before `enabled` stored the choice as whether a folder was picked.
    if (old && !('enabled' in old) && 'root' in old) merged.enabled = Boolean(old.root)
    return { autosave: { enabled: merged.enabled, delay: merged.delay, kinds: merged.kinds } }
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

import { create } from 'zustand'
import type { DocKind } from '../lib/kinds'
import type { CloudProvider } from '../lib/platform'

export interface AutosaveSettings {
  /** The synced folder documents go to; null turns autosave off. */
  root: string | null
  /** Which app syncs `root`, or 'folder' for one the user picked themselves. */
  provider: CloudProvider | 'folder' | null
  /** How the UI names the destination, e.g. “iCloud Drive” or “OneDrive – Contoso”. */
  label: string
  /** Folder inside `root` that new documents are saved to. */
  subfolder: string
  /** Seconds to wait after the last edit before saving. */
  delay: number
  kinds: Record<DocKind, boolean>
  /** Also autosave files stored outside `root`, where they are. */
  everywhere: boolean
}

export interface Settings {
  autosave: AutosaveSettings
}

export const DEFAULT_SETTINGS: Settings = {
  autosave: {
    root: null,
    provider: null,
    label: '',
    subfolder: 'Workspace',
    delay: 3,
    // Saving a PDF rewrites the whole file, so PDFs wait for ⌘S unless you opt in.
    kinds: { docx: true, pptx: true, md: true, txt: true, pdf: false },
    everywhere: false,
  },
}

const KEY = 'workspace.settings'

function load(): Settings {
  try {
    const saved = JSON.parse(localStorage.getItem(KEY) || '{}') as Partial<Settings>
    // Settings added since the last save take their defaults.
    const autosave = { ...DEFAULT_SETTINGS.autosave, ...saved.autosave }
    autosave.kinds = { ...DEFAULT_SETTINGS.autosave.kinds, ...saved.autosave?.kinds }
    return { ...DEFAULT_SETTINGS, ...saved, autosave }
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

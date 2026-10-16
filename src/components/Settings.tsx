import { Moon, Palette, Save, Sun, X } from 'lucide-react'
import type { ReactNode } from 'react'
import { useEffect, useRef, useState } from 'react'
import type { DocKind } from '../lib/kinds'
import { shortcut } from '../lib/platform'
import { useSettings } from '../state/settings'
import { useWorkspace } from '../state/workspace'
import { IconButton, Segmented, Switch } from './ui'

const KIND_OPTIONS: { kind: DocKind; label: string }[] = [
  { kind: 'docx', label: 'Word documents' },
  { kind: 'pptx', label: 'Presentations' },
  { kind: 'md', label: 'Markdown notes' },
  { kind: 'txt', label: 'Text files' },
  { kind: 'pdf', label: 'PDFs' },
]

const DELAYS = [
  { value: '1', label: '1 sec' },
  { value: '3', label: '3 sec' },
  { value: '10', label: '10 sec' },
  { value: '30', label: '30 sec' },
]

type Page = 'autosave' | 'appearance'

const PAGES: { id: Page; label: string; icon: ReactNode }[] = [
  { id: 'autosave', label: 'Autosave', icon: <Save size={15} strokeWidth={1.75} /> },
  { id: 'appearance', label: 'Appearance', icon: <Palette size={15} strokeWidth={1.75} /> },
]

export default function SettingsPanel() {
  const setOpen = useSettings((s) => s.setOpen)
  const [page, setPage] = useState<Page>('autosave')
  const dialog = useRef<HTMLDivElement>(null)

  useEffect(() => {
    dialog.current?.focus()
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.stopPropagation()
        setOpen(false)
      }
    }
    window.addEventListener('keydown', onKey, true)
    return () => window.removeEventListener('keydown', onKey, true)
  }, [setOpen])

  return (
    <div className="settings-backdrop" onMouseDown={(e) => e.target === e.currentTarget && setOpen(false)}>
      <div className="settings" role="dialog" aria-modal="true" aria-labelledby="settings-title" tabIndex={-1} ref={dialog}>
        <nav className="settings-nav" aria-label="Settings sections">
          <h2 id="settings-title">Settings</h2>
          {PAGES.map((p) => (
            <button key={p.id} type="button" className={`settings-nav-item ${page === p.id ? 'on' : ''}`} aria-current={page === p.id} onClick={() => setPage(p.id)}>
              {p.icon}
              {p.label}
            </button>
          ))}
        </nav>
        <div className="settings-page">
          <header className="settings-page-header">
            <h3>{PAGES.find((p) => p.id === page)!.label}</h3>
            <IconButton label="Close (esc)" onClick={() => setOpen(false)}>
              <X size={16} />
            </IconButton>
          </header>
          <div className="settings-scroll">{page === 'autosave' ? <AutosavePage /> : <AppearancePage />}</div>
        </div>
      </div>
    </div>
  )
}

function AutosavePage() {
  const autosave = useSettings((s) => s.autosave)
  const setAutosave = useSettings((s) => s.setAutosave)

  return (
    <>
      <p className="settings-intro">
        A file that already lives somewhere is saved there a few seconds after you stop editing. A new document stays unsaved until you save it with {shortcut('⌘S')}.
      </p>

      <div className="settings-row">
        <div className="settings-row-text">
          <span className="settings-label">Autosave</span>
          <span className="settings-hint">Turn this off and every file waits for {shortcut('Save')}.</span>
        </div>
        <div className="settings-row-control">
          <Switch label="Autosave" checked={autosave.enabled} onChange={(enabled) => setAutosave({ enabled })} />
        </div>
      </div>

      <fieldset className="settings-fields" disabled={!autosave.enabled}>
        <div className="settings-row">
          <div className="settings-row-text">
            <span className="settings-label">Save after you stop editing for</span>
            <span className="settings-hint">If you keep going, it still saves every 30 seconds.</span>
          </div>
          <div className="settings-row-control">
            <Segmented value={String(autosave.delay)} options={DELAYS} onChange={(v) => setAutosave({ delay: Number(v) })} disabled={!autosave.enabled} />
          </div>
        </div>

        <div className="settings-row column">
          <div className="settings-row-text">
            <span className="settings-label">Autosave these files</span>
            <span className="settings-hint">Saving a PDF rewrites the whole file, so PDFs start out off.</span>
          </div>
          <div className="kind-checks">
            {KIND_OPTIONS.map(({ kind, label }) => (
              <label key={kind} className="check">
                <input
                  type="checkbox"
                  checked={autosave.kinds[kind]}
                  onChange={(e) => setAutosave({ kinds: { ...autosave.kinds, [kind]: e.currentTarget.checked } })}
                />
                {label}
              </label>
            ))}
          </div>
        </div>
      </fieldset>
    </>
  )
}

function AppearancePage() {
  const theme = useWorkspace((s) => s.theme)
  const setTheme = useWorkspace((s) => s.setTheme)
  return (
    <div className="settings-row">
      <div className="settings-row-text">
        <span className="settings-label">Theme</span>
        <span className="settings-hint">{shortcut('Switch any time with ⇧⌘L.')}</span>
      </div>
      <div className="settings-row-control">
        <Segmented
          value={theme}
          onChange={setTheme}
          options={[
            { value: 'light', label: 'Light', icon: <Sun size={14} /> },
            { value: 'dark', label: 'Dark', icon: <Moon size={14} /> },
          ]}
        />
      </div>
    </div>
  )
}

import { Keyboard, Moon, Palette, RotateCcw, Save, Search, Sun, X } from 'lucide-react'
import type { ReactNode } from 'react'
import { useEffect, useRef, useState } from 'react'
import type { DocKind } from '../lib/kinds'
import { shortcut } from '../lib/platform'
import { useSettings } from '../state/settings'
import type { ShortcutDef } from '../state/shortcuts'
import { SHORTCUTS, isValidKeys, keysFor, keysFromEvent, syncMenu, useShortcuts } from '../state/shortcuts'
import { useWorkspace } from '../state/workspace'
import { IconButton, Segmented, Switch } from './ui'

const KIND_OPTIONS: { kind: DocKind; label: string }[] = [
  { kind: 'docx', label: 'Documents' },
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

type Page = 'autosave' | 'appearance' | 'shortcuts'

const PAGES: { id: Page; label: string; icon: ReactNode }[] = [
  { id: 'autosave', label: 'Autosave', icon: <Save size={15} strokeWidth={1.75} /> },
  { id: 'appearance', label: 'Appearance', icon: <Palette size={15} strokeWidth={1.75} /> },
  { id: 'shortcuts', label: 'Keyboard Shortcuts', icon: <Keyboard size={15} strokeWidth={1.75} /> },
]

/** Set while a shortcut is being recorded, so esc cancels that instead of closing Settings. */
let recording = false

export default function SettingsPanel() {
  const setOpen = useSettings((s) => s.setOpen)
  const [page, setPage] = useState<Page>('autosave')
  const dialog = useRef<HTMLDivElement>(null)

  useEffect(() => {
    dialog.current?.focus()
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && !recording) {
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
          <div className="settings-scroll">{page === 'autosave' ? <AutosavePage /> : page === 'appearance' ? <AppearancePage /> : <ShortcutsPage />}</div>
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

/** Every shortcut, grouped; click one and press new keys to change it. */
function ShortcutsPage() {
  const custom = useShortcuts((s) => s.custom)
  const resetAll = useShortcuts((s) => s.resetAll)
  const [query, setQuery] = useState('')
  const [editing, setEditing] = useState<string | null>(null)
  const [note, setNote] = useState<{ id: string; text: string } | null>(null)
  const q = query.trim().toLowerCase()
  const shown = SHORTCUTS.filter((s) => !q || s.label.toLowerCase().includes(q) || s.group.toLowerCase().includes(q) || shortcut(keysFor(s.id, custom)).toLowerCase().includes(q))
  const groups = [...new Set(shown.map((s) => s.group))]
  const changed = Object.keys(custom).length > 0

  return (
    <>
      <p className="settings-intro">Click a shortcut and press the keys you want instead. Press {shortcut('⌫')} to remove one, or esc to leave it as it was.</p>
      <div className="shortcut-tools">
        <label className="field shortcut-search">
          <Search size={13} className="faint" />
          <input value={query} placeholder="Search shortcuts" spellCheck={false} onChange={(e) => setQuery(e.currentTarget.value)} />
        </label>
        <button type="button" className="btn" disabled={!changed} onClick={() => (resetAll(), setNote(null))}>
          <RotateCcw size={13} /> Reset all
        </button>
      </div>
      {groups.map((group) => (
        <section key={group} className="shortcut-group">
          <h4>{group}</h4>
          {shown
            .filter((s) => s.group === group)
            .map((s) => (
              <ShortcutRow
                key={s.id}
                def={s}
                keys={keysFor(s.id, custom)}
                changed={s.id in custom}
                editing={editing === s.id}
                note={note?.id === s.id ? note.text : null}
                onEdit={(on) => {
                  setEditing(on ? s.id : null)
                  if (on) setNote(null)
                }}
                onNote={(text) => setNote(text ? { id: s.id, text } : null)}
              />
            ))}
        </section>
      ))}
      {!groups.length && <p className="settings-hint">No shortcuts match “{query}”.</p>}
    </>
  )
}

function ShortcutRow({
  def,
  keys,
  changed,
  editing,
  note,
  onEdit,
  onNote,
}: {
  def: ShortcutDef
  keys: string
  changed: boolean
  editing: boolean
  note: string | null
  onEdit: (on: boolean) => void
  onNote: (text: string | null) => void
}) {
  const assign = useShortcuts((s) => s.assign)
  const reset = useShortcuts((s) => s.reset)
  const [hint, setHint] = useState<string | null>(null)
  // The page passes new callbacks every render; recording must not restart for that.
  const done = useRef({ onEdit, onNote })
  done.current = { onEdit, onNote }

  useEffect(() => {
    if (!editing) return
    const { onEdit, onNote } = done.current
    recording = true
    setHint(null)
    void syncMenu({ paused: true })
    const onKey = (e: KeyboardEvent) => {
      e.preventDefault()
      e.stopPropagation()
      const pressed = keysFromEvent(e)
      if (!pressed) return
      if (pressed === 'Esc') return onEdit(false)
      if (pressed === '⌫' || pressed === '⌦') {
        assign(def.id, '')
        return onEdit(false)
      }
      if (!isValidKeys(pressed)) {
        setHint(shortcut(`Include ⌘ in the shortcut, or use a function key.`))
        return
      }
      const lost = assign(def.id, pressed)
      onNote(lost.length ? `Removed from ${lost.map((l) => l.label).join(', ')}.` : null)
      onEdit(false)
    }
    // Leaving the field, or clicking elsewhere, stops recording.
    const onDown = (e: MouseEvent) => !(e.target as HTMLElement).closest('.shortcut-keys.recording') && onEdit(false)
    window.addEventListener('keydown', onKey, true)
    window.addEventListener('mousedown', onDown, true)
    return () => {
      recording = false
      window.removeEventListener('keydown', onKey, true)
      window.removeEventListener('mousedown', onDown, true)
      void syncMenu()
    }
  }, [editing, def.id, assign])

  return (
    <div className="shortcut-row">
      <span className="shortcut-label">
        {def.label}
        {def.fixed && <span className="settings-hint"> · can’t be changed</span>}
        {note && <span className="shortcut-note">{note}</span>}
        {editing && hint && <span className="shortcut-note">{hint}</span>}
      </span>
      {changed && !editing && (
        <IconButton label="Use the default" size="sm" onClick={() => (reset(def.id), onNote(null))}>
          <RotateCcw size={13} />
        </IconButton>
      )}
      <button
        type="button"
        className={`shortcut-keys ${editing ? 'recording' : ''} ${keys ? '' : 'none'}`}
        disabled={def.fixed}
        aria-label={`${def.label}: ${keys ? shortcut(keys) : 'no shortcut'}. Change`}
        onClick={() => onEdit(!editing)}
      >
        {editing ? 'Press keys…' : keys ? <Keys keys={keys} /> : 'None'}
      </button>
    </div>
  )
}

/** Keys as separate caps on a Mac (⇧ ⌘ N) and as Ctrl+Shift+N on Windows. */
function Keys({ keys }: { keys: string }) {
  const text = shortcut(keys)
  const caps = text.includes('+') ? text.split('+') : Array.from(text.match(/[⌃⌥⇧⌘]|[^⌃⌥⇧⌘]+/g) ?? [text])
  return (
    <>
      {caps.map((c, i) => (
        <kbd key={i}>{c}</kbd>
      ))}
    </>
  )
}

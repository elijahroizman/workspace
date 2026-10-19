import { ArrowLeft, Blocks, Copy, Keyboard, Monitor, Moon, Palette, Pencil, Plus, RotateCcw, Save, Search, Settings2, Sun, Trash2, X } from 'lucide-react'
import type { ReactNode } from 'react'
import { lazy, Suspense, useEffect, useRef, useState } from 'react'
import { canSetDefaults, defaultStatus, makeDefault } from '../lib/defaults'
import type { CliStatus } from '../lib/platform'
import { cliStatus, confirmDialog, isLinux, isMac, isTauri, openExternal, setCliInstalled, shortcut, showError } from '../lib/platform'
import type { ExtraFont } from '../state/fonts'
import { EXTRA_FONTS, useExtraFonts } from '../state/fonts'
import type { Appearance, ThemeDef } from '../lib/themes'
import { isHex, orbBackground } from '../lib/themes'
import { openUpdatePanel } from '../lib/updater'
import { PLUGINS, isBuiltIn } from '../plugins/catalog'
import { allThemes, useAppearance } from '../state/appearance'
import { enabledKinds, formatSize, usePlugins } from '../state/plugins'
import type { SettingsPage } from '../state/settings'
import { PREVIEW_DELAYS, useSettings } from '../state/settings'
import { INSTALL_CHOICES, useTex } from '../state/tex'
import { useSetup } from '../state/setup'
import type { ShortcutDef } from '../state/shortcuts'
import { SHORTCUTS, isValidKeys, keysFor, keysFromEvent, syncMenu, useShortcuts } from '../state/shortcuts'
import { useWorkspace } from '../state/workspace'
import { PluginRow } from './PluginList'
import { DocBadge } from './Workbench'
import { IconButton, Segmented, Spinner, Switch } from './ui'

const LicensesPage = lazy(() => import('./Licenses'))

const DELAYS = [
  { value: '1', label: '1 sec' },
  { value: '3', label: '3 sec' },
  { value: '10', label: '10 sec' },
  { value: '30', label: '30 sec' },
]

const PAGES: { id: SettingsPage; label: string; icon: ReactNode }[] = [
  { id: 'general', label: 'General', icon: <Settings2 size={15} strokeWidth={1.75} /> },
  { id: 'plugins', label: 'Plugins', icon: <Blocks size={15} strokeWidth={1.75} /> },
  { id: 'autosave', label: 'Autosave', icon: <Save size={15} strokeWidth={1.75} /> },
  { id: 'appearance', label: 'Appearance', icon: <Palette size={15} strokeWidth={1.75} /> },
  { id: 'shortcuts', label: 'Keyboard Shortcuts', icon: <Keyboard size={15} strokeWidth={1.75} /> },
]

/** Set while a shortcut is being recorded, so esc cancels that instead of closing Settings. */
let recording = false

export default function SettingsPanel() {
  const setOpen = useSettings((s) => s.setOpen)
  const page = useSettings((s) => s.page)
  const setPage = useSettings((s) => s.setPage)
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
            <button
              key={p.id}
              type="button"
              className={`settings-nav-item ${page === p.id || (page === 'licenses' && p.id === 'general') ? 'on' : ''}`}
              aria-current={page === p.id}
              onClick={() => setPage(p.id)}
            >
              {p.icon}
              {p.label}
            </button>
          ))}
        </nav>
        <div className="settings-page">
          <header className="settings-page-header">
            {page === 'licenses' ? (
              <button type="button" className="settings-back" onClick={() => setPage('general')}>
                <ArrowLeft size={15} />
                <h3>Open-source licenses</h3>
              </button>
            ) : (
              <h3>{PAGES.find((p) => p.id === page)!.label}</h3>
            )}
            <IconButton label="Close (esc)" onClick={() => setOpen(false)}>
              <X size={16} />
            </IconButton>
          </header>
          <div className="settings-scroll" key={page}>
            {page === 'general' && <GeneralPage />}
            {page === 'plugins' && <PluginsPage />}
            {page === 'autosave' && <AutosavePage />}
            {page === 'appearance' && <AppearancePage />}
            {page === 'shortcuts' && <ShortcutsPage />}
            {page === 'licenses' && (
              <Suspense fallback={<Spinner />}>
                <LicensesPage />
              </Suspense>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}

function GeneralPage() {
  const setOpen = useSettings((s) => s.setOpen)
  const setPage = useSettings((s) => s.setPage)
  return (
    <>
      <div className="settings-row">
        <div className="settings-row-text">
          <span className="settings-label">Workspace {__APP_VERSION__}</span>
          <span className="settings-hint">{isLinux ? 'New versions come through apt, with your system’s other updates, or from Check for updates.' : 'Updates download by themselves and install when you quit.'}</span>
        </div>
        <div className="settings-row-control">
          <button type="button" className="btn" onClick={() => (setOpen(false), openUpdatePanel())}>
            Check for updates
          </button>
        </div>
      </div>

      <DefaultAppsRow />

      <RecentFilesRow />

      <CommandLineRow />

      <div className="settings-row">
        <div className="settings-row-text">
          <span className="settings-label">Setup</span>
          <span className="settings-hint">Go through the first-launch screen again: plugins and default apps.</span>
        </div>
        <div className="settings-row-control">
          <button type="button" className="btn" onClick={() => (setOpen(false), useSetup.getState().show())}>
            Run setup again
          </button>
        </div>
      </div>

      <div className="settings-row">
        <div className="settings-row-text">
          <span className="settings-label">Open-source licenses</span>
          <span className="settings-hint">Workspace is built on open-source engines, including Excalidraw, PDFium and docx-editor.</span>
        </div>
        <div className="settings-row-control">
          <button type="button" className="btn" onClick={() => setPage('licenses')}>
            View licenses
          </button>
        </div>
      </div>
    </>
  )
}

/** The `workspace` shell command: installed from here on a Mac, already there on Linux. */
function CommandLineRow() {
  const [status, setStatus] = useState<CliStatus | null>(null)
  const [busy, setBusy] = useState(false)
  useEffect(() => {
    void cliStatus().then(setStatus)
  }, [])
  if (!status || (!status.supported && !status.installed)) return null
  const toggle = async () => {
    setBusy(true)
    try {
      await setCliInstalled(!status.installed)
    } catch (err) {
      await showError(String(err), status.installed ? 'Couldn’t remove the command' : 'Couldn’t install the command')
    } finally {
      setStatus(await cliStatus())
      setBusy(false)
    }
  }
  return (
    <div className="settings-row">
      <div className="settings-row-text">
        <span className="settings-label">Command line</span>
        <span className="settings-hint">
          {status.taken
            ? `Something else is already at ${status.path}, so Workspace can’t put its command there.`
            : status.supported
              ? `Open files and folders from Terminal: workspace . opens the folder you’re in, workspace notes.md a file. ${status.installed ? `Installed at ${status.path}.` : 'Installing asks for your password.'}`
              : 'Open files and folders from a terminal: workspace . opens the folder you’re in, workspace notes.md a file.'}
        </span>
      </div>
      {status.supported && !status.taken && (
        <div className="settings-row-control">
          <button type="button" className="btn" disabled={busy} onClick={() => void toggle()}>
            {status.installed ? 'Remove command' : 'Install command'}
          </button>
        </div>
      )}
    </div>
  )
}

/** Home's Recent list: which file types get a tab, and clearing the history. */
function RecentFilesRow() {
  const plugins = usePlugins((s) => s.enabled)
  const recentTabs = useSettings((s) => s.recentTabs)
  const setRecentTab = useSettings((s) => s.setRecentTab)
  const count = useWorkspace((s) => s.recents.length)
  return (
    <div className="settings-row column">
      <div className="settings-row-text">
        <span className="settings-label">Recent files</span>
        <span className="settings-hint">Every file you open is under All. Choose which types also get a tab of their own on Home.</span>
      </div>
      <div className="kind-checks">
        {enabledKinds(plugins).map((k) => (
          <label key={k.id} className="check">
            <input type="checkbox" checked={recentTabs[k.id] !== false} onChange={(e) => setRecentTab(k.id, e.currentTarget.checked)} />
            {k.short}
          </label>
        ))}
      </div>
      <div className="settings-inline">
        <button type="button" className="btn" disabled={!count} onClick={() => useWorkspace.getState().clearRecents()}>
          Clear file history
        </button>
        <span className="settings-hint">{count ? `Forgets the ${count === 1 ? 'file' : `${count} files`} on Home. The files themselves stay where they are.` : 'There’s nothing in the history.'}</span>
      </div>
    </div>
  )
}

/** Which file types open in Workspace, and a button for each that doesn't. */
function DefaultAppsRow() {
  const plugins = usePlugins((s) => s.enabled)
  const kinds = enabledKinds(plugins)
  const [status, setStatus] = useState<Record<string, boolean | null>>({})
  const [busy, setBusy] = useState(false)
  const key = kinds.map((k) => k.id).join()

  const refresh = () => void defaultStatus(kinds.map((k) => k.id)).then(setStatus, () => {})
  useEffect(() => {
    refresh()
    // Windows: the user picks in Settings, then comes back.
    window.addEventListener('focus', refresh)
    return () => window.removeEventListener('focus', refresh)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key])

  const set = async (ids: string[]) => {
    setBusy(true)
    try {
      await makeDefault(ids)
    } catch (err) {
      await showError(String(err))
    } finally {
      setBusy(false)
      refresh()
    }
  }

  if (!canSetDefaults) return null
  const missing = kinds.filter((k) => status[k.id] === false).map((k) => k.id)
  return (
    <div className="settings-row column">
      <div className="settings-row-text">
        <span className="settings-label">Default apps</span>
        <span className="settings-hint">
          {isMac ? 'Double-clicking these files in Finder opens them in Workspace.' : 'Windows asks you to confirm each one in Settings › Default apps.'}
        </span>
      </div>
      <div className="default-apps">
        {kinds.map((k) => (
          <div key={k.id} className="default-app">
            <DocBadge kind={k.id} size={22} />
            <span className="default-app-name">
              {k.label} <span className="faint">{k.extensions.map((e) => `.${e}`).join(' ')}</span>
            </span>
            {status[k.id] ? (
              <span className="faint">Opens in Workspace</span>
            ) : (
              <button type="button" className="btn" disabled={busy || status[k.id] == null} onClick={() => void set([k.id])}>
                Make default
              </button>
            )}
          </div>
        ))}
      </div>
      {missing.length > 1 && (
        <div>
          <button type="button" className="btn" disabled={busy} onClick={() => void set(missing)}>
            Make Workspace the default for all
          </button>
        </div>
      )}
    </div>
  )
}

/** Everything optional in one place: plugins for more file types, and fonts to download. */
function PluginsPage() {
  const enabled = usePlugins((s) => s.enabled)
  const progress = usePlugins((s) => s.progress)
  const fonts = useExtraFonts((s) => s.installed)
  const { enable, disable } = usePlugins.getState()
  const optional = PLUGINS.filter((p) => !isBuiltIn(p))
  const count = (on: number, all: number) => <span className="plugin-count">{on ? `${on} of ${all} on` : 'All off'}</span>
  return (
    <>
      <p className="settings-intro">Turn on only what you need. Word, PowerPoint, PDF, Markdown and text files always open.</p>
      <section className="plugin-group">
        <h4>
          File types {count(optional.filter((p) => enabled[p.id]).length, optional.length)}
        </h4>
        {optional.map((p) => (
          <PluginRow
            key={p.id}
            plugin={p}
            control={
              progress[p.id] ? (
                <Spinner size={16} />
              ) : (
                <Switch
                  label={`Use ${p.name}`}
                  checked={!!enabled[p.id]}
                  onChange={(on) => void (on ? enable(p.id) : disablePlugin(p.id, disable))}
                />
              )
            }
          >
            <button type="button" className="link-btn" onClick={() => void openExternal(p.homepage)}>
              {p.homepage.replace(/^https:\/\//, '')}
            </button>
            {p.services?.includes('tex') && enabled[p.id] && <TexSettings />}
          </PluginRow>
        ))}
      </section>
      <section className="plugin-group">
        <h4>
          Fonts {count(EXTRA_FONTS.filter((f) => fonts[f.id]).length, EXTRA_FONTS.length)}
        </h4>
        <p className="settings-hint plugin-group-hint">
          {isTauri ? 'Downloaded when you turn one on, then in the font menus for Word and PowerPoint.' : 'Fonts download in the app, not in the browser version.'}
        </p>
        {EXTRA_FONTS.map((f) => (
          <FontRow key={f.id} font={f} />
        ))}
      </section>
    </>
  )
}

/** A font Workspace downloads from its maker (state/fonts.ts): on downloads it, off removes it. */
function FontRow({ font }: { font: ExtraFont }) {
  const installed = useExtraFonts((s) => !!s.installed[font.id])
  const busy = useExtraFonts((s) => !!s.busy[font.id])
  const error = useExtraFonts((s) => s.errors[font.id])
  const { install, remove } = useExtraFonts.getState()
  // Shown in the font itself once it's there.
  const face = installed ? `'${font.family}', ${font.fallback}` : undefined
  return (
    <div className="plugin-row">
      <span className="font-badge" style={{ fontFamily: face }} aria-hidden="true">
        Aa
      </span>
      <span className="plugin-text">
        <span className="settings-label" style={{ fontFamily: face }}>
          {font.family}
        </span>
        <span className="settings-hint">{font.about}</span>
        <span className="settings-hint plugin-meta">
          {font.maker} · {formatSize(font.size)} download ·{' '}
          <button type="button" className="link-btn" onClick={() => void openExternal(font.licenseUrl)}>
            License
          </button>
        </span>
        {error && <span className="plugin-error">{error}</span>}
      </span>
      <span className="plugin-control">
        {busy ? (
          <Spinner size={16} />
        ) : (
          <Switch label={`Use the ${font.family} font`} checked={installed} disabled={!isTauri} onChange={(on) => void (on ? install(font.id) : remove(font.id))} />
        )}
      </span>
    </div>
  )
}

/** Under LaTeX: which TeX compiles, and how soon after typing stops. */
function TexSettings() {
  const status = useTex((s) => s.status)
  const installing = useTex((s) => s.installing)
  const previewDelay = useSettings((s) => s.previewDelay)
  const setPreviewDelay = useSettings((s) => s.setPreviewDelay)
  useEffect(() => void useTex.getState().refresh(), [])
  return (
    <div className="plugin-extra">
      <div className="plugin-extra-row">
        <span className="settings-hint">
          {installing
            ? 'Installing TeX…'
            : !status
            ? 'Looking for TeX…'
            : status.installed
              ? `Compiles with ${status.distribution ?? 'TeX'} (${status.engines.join(', ')}).`
              : 'TeX isn’t installed, so documents can’t compile.'}
        </span>
        {installing ? (
          <button type="button" className="btn" onClick={() => useTex.setState({ offer: true })}>
            Show progress
          </button>
        ) : (
          status &&
          !status.installed &&
          INSTALL_CHOICES.length > 0 && (
            <button type="button" className="btn" onClick={() => void useTex.getState().offerInstall()}>
              Install TeX…
            </button>
          )
        )}
      </div>
      <div className="plugin-extra-row">
        <span className="settings-hint">Update the PDF after you stop typing for</span>
        <Segmented
          value={String(previewDelay)}
          options={PREVIEW_DELAYS.map((d) => ({ value: String(d), label: `${d} sec` }))}
          onChange={(v) => setPreviewDelay(Number(v))}
        />
      </div>
    </div>
  )
}

/** Tabs of a plugin's files have to close first. */
async function disablePlugin(id: string, disable: (id: string) => Promise<void>) {
  const plugin = PLUGINS.find((p) => p.id === id)!
  const kinds = new Set(plugin.kinds.map((k) => k.id))
  const open = useWorkspace.getState().tabs.filter((t) => kinds.has(t.kind))
  if (open.length) {
    const tabs = open.length === 1 ? `“${open[0].title}”` : `${open.length} tabs`
    const ok = await confirmDialog(`${plugin.name} can’t turn off while ${tabs} ${open.length === 1 ? 'is' : 'are'} open. Workspace asks before closing anything with unsaved changes.`, {
      title: `Close ${tabs} and turn off ${plugin.name}?`,
      okLabel: open.length === 1 ? 'Close Tab' : 'Close Tabs',
    })
    if (!ok) return
    for (const tab of open) if (!(await useWorkspace.getState().closeTab(tab.id))) return
  }
  // LaTeX uses the computer's own TeX; offer to remove that too (unticked unless they choose).
  if (plugin.services?.includes('tex') && !(await useTex.getState().confirmTurnOff())) return
  await disable(id)
}

function AutosavePage() {
  const autosave = useSettings((s) => s.autosave)
  const setAutosave = useSettings((s) => s.setAutosave)
  const plugins = usePlugins((s) => s.enabled)

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
            <span className="settings-hint">Files you untick wait for {shortcut('Save')}.</span>
          </div>
          <div className="kind-checks">
            {enabledKinds(plugins).map((k) => (
              <label key={k.id} className="check">
                <input
                  type="checkbox"
                  checked={autosave.kinds[k.id] !== false}
                  onChange={(e) => setAutosave({ kinds: { ...autosave.kinds, [k.id]: e.currentTarget.checked } })}
                />
                {k.label}
              </label>
            ))}
          </div>
        </div>
      </fieldset>
    </>
  )
}

function AppearancePage() {
  const mode = useWorkspace((s) => s.themeMode)
  const setThemeMode = useWorkspace((s) => s.setThemeMode)
  const light = useAppearance((s) => s.light)
  const dark = useAppearance((s) => s.dark)
  const custom = useAppearance((s) => s.custom)
  const { use, remove } = useAppearance.getState()
  const [editing, setEditing] = useState<ThemeDef | null>(null)

  return (
    <>
      <div className="settings-row">
        <div className="settings-row-text">
          <span className="settings-label">Appearance</span>
          <span className="settings-hint">{shortcut('System follows your computer. Switch between light and dark any time with ⇧⌘L.')}</span>
        </div>
        <div className="settings-row-control">
          <Segmented
            value={mode}
            onChange={setThemeMode}
            options={[
              { value: 'system', label: 'System', icon: <Monitor size={14} /> },
              { value: 'light', label: 'Light', icon: <Sun size={14} /> },
              { value: 'dark', label: 'Dark', icon: <Moon size={14} /> },
            ]}
          />
        </div>
      </div>

      <section className="theme-section">
        <div className="theme-section-header">
          <h4>Themes</h4>
          {!editing && (
            <button type="button" className="btn" onClick={() => setEditing(blankTheme())}>
              <Plus size={14} /> Create theme
            </button>
          )}
        </div>
        {editing && (
          <ThemeEditor
            theme={editing}
            onChange={setEditing}
            onCancel={() => setEditing(null)}
            onSave={() => {
              useAppearance.getState().save(editing)
              // A new theme is used straight away.
              if (!custom.some((t) => t.id === editing.id)) use(editing.id)
              setEditing(null)
            }}
          />
        )}
        <div className="theme-grid">
          {allThemes(custom).map((t) => (
            <div key={t.id} className="theme-card">
              <div className="theme-orbs">
                <Orb theme={t} mode="light" selected={light === t.id} onSelect={() => use(t.id, 'light')} />
                <Orb theme={t} mode="dark" selected={dark === t.id} onSelect={() => use(t.id, 'dark')} />
              </div>
              <div className="theme-card-foot">
                <button type="button" className="theme-name" title="Use for light and dark" onClick={() => use(t.id)}>
                  {t.name}
                </button>
                {t.custom && (
                  <>
                    <IconButton label="Edit theme" size="sm" onClick={() => setEditing({ ...t })}>
                      <Pencil size={13} />
                    </IconButton>
                    <IconButton
                      label="Delete theme"
                      size="sm"
                      onClick={() =>
                        void confirmDialog('You can’t undo this.', { title: `Delete the theme “${t.name}”?`, okLabel: 'Delete', danger: true }).then((ok) => ok && remove(t.id))
                      }
                    >
                      <Trash2 size={13} />
                    </IconButton>
                  </>
                )}
                <IconButton label="Make a copy to change" size="sm" onClick={() => setEditing({ ...t, id: newThemeId(), name: `${t.name} copy`, custom: true })}>
                  <Copy size={13} />
                </IconButton>
              </div>
            </div>
          ))}
        </div>
      </section>
    </>
  )
}

const newThemeId = () => `custom-${Math.random().toString(36).slice(2, 8)}`
const blankTheme = (): ThemeDef => ({ id: newThemeId(), name: 'My theme', accent: '#e0527a', light: '#f0d8e2', dark: '#2a1822', custom: true })

/** Two orbs per theme: how it looks in light and in dark. Click one to use the theme for just that appearance. */
function Orb({ theme, mode, selected, onSelect }: { theme: ThemeDef; mode: Appearance; selected: boolean; onSelect: () => void }) {
  return (
    <button
      type="button"
      className={`theme-orb ${selected ? 'on' : ''}`}
      title={`Use for ${mode} mode only`}
      aria-label={`${theme.name}: use for ${mode} mode only`}
      aria-pressed={selected}
      onClick={onSelect}
    >
      <span className="theme-orb-ball" style={{ background: orbBackground(theme, mode) }} />
      {selected && <span className="theme-orb-badge">{mode === 'light' ? <Sun size={11} /> : <Moon size={11} />}</span>}
    </button>
  )
}

/** The name, the accent, and the tone each appearance takes its surfaces from. */
function ThemeEditor({ theme, onChange, onSave, onCancel }: { theme: ThemeDef; onChange: (theme: ThemeDef) => void; onSave: () => void; onCancel: () => void }) {
  const valid = theme.name.trim().length > 0 && isHex(theme.accent) && isHex(theme.light) && isHex(theme.dark)
  const swatch = (label: string, key: 'accent' | 'light' | 'dark') => (
    <label className="theme-color">
      <input type="color" value={theme[key]} onChange={(e) => onChange({ ...theme, [key]: e.currentTarget.value })} />
      <span>{label}</span>
    </label>
  )
  return (
    <div className="theme-editor">
      <div className="theme-orbs preview" aria-hidden="true">
        <span className="theme-orb-ball" style={{ background: orbBackground(theme, 'light') }} />
        <span className="theme-orb-ball" style={{ background: orbBackground(theme, 'dark') }} />
      </div>
      <div className="theme-editor-fields">
        <label className="field">
          <input value={theme.name} maxLength={40} placeholder="Theme name" spellCheck={false} onChange={(e) => onChange({ ...theme, name: e.currentTarget.value })} />
        </label>
        <div className="theme-colors">
          {swatch('Accent', 'accent')}
          {swatch('Light tone', 'light')}
          {swatch('Dark tone', 'dark')}
        </div>
        <div className="theme-editor-actions">
          <button type="button" className="btn primary" disabled={!valid} onClick={onSave}>
            Save theme
          </button>
          <button type="button" className="btn" onClick={onCancel}>
            Cancel
          </button>
        </div>
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

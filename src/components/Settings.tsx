import { Cloud, Folder, FolderOpen, Moon, Palette, RefreshCw, Sun, X } from 'lucide-react'
import type { ReactNode } from 'react'
import { useEffect, useRef, useState } from 'react'
import { TbBrandDropbox, TbBrandGoogleDrive, TbBrandOnedrive, TbCloud } from 'react-icons/tb'
import { autosaveFolder } from '../lib/autosave'
import type { DocKind } from '../lib/kinds'
import type { CloudFolder, CloudProvider } from '../lib/platform'
import { basename, cloudFolders, isTauri, pathExists, pickFolder, revealInFinder, revealLabel, shortcut, tildify } from '../lib/platform'
import { useSettings } from '../state/settings'
import { useWorkspace } from '../state/workspace'
import { IconButton, Segmented, Spinner, Switch } from './ui'

const PROVIDERS: { id: CloudProvider; name: string; color: string; icon: ReactNode; app: string }[] = [
  { id: 'icloud', name: 'iCloud Drive', color: '#3693f3', icon: <TbCloud />, app: 'Turn on iCloud Drive in System Settings, or install iCloud for Windows.' },
  { id: 'dropbox', name: 'Dropbox', color: '#0061fe', icon: <TbBrandDropbox />, app: 'Install the Dropbox app and sign in there.' },
  { id: 'onedrive', name: 'OneDrive', color: '#0078d4', icon: <TbBrandOnedrive />, app: 'Install the OneDrive app and sign in there.' },
  { id: 'gdrive', name: 'Google Drive', color: '#1fa463', icon: <TbBrandGoogleDrive />, app: 'Install Google Drive for desktop and sign in there.' },
]

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
  { id: 'autosave', label: 'Autosave', icon: <Cloud size={15} strokeWidth={1.75} /> },
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
  const [folders, setFolders] = useState<CloudFolder[] | null>(null)
  const [folderExists, setFolderExists] = useState(false)
  const folder = autosaveFolder(autosave)

  const detect = async () => {
    setFolders(null)
    try {
      setFolders(await cloudFolders())
    } catch {
      setFolders([])
    }
  }
  useEffect(() => void detect(), [])

  useEffect(() => {
    if (folder) void pathExists(folder).then(setFolderExists)
  }, [folder])

  const chooseFolder = async () => {
    const path = await pickFolder()
    if (path) setAutosave({ root: path, provider: 'folder', label: basename(path) })
  }

  return (
    <>
      <p className="settings-intro">
        Workspace saves your changes a few seconds after you stop editing. New documents go to a folder in your cloud drive, and the drive’s own app on this
        computer uploads them. Workspace doesn’t sign in to anything.
      </p>

      <div className="settings-group">
        <div className="settings-group-header">
          <span className="settings-label">Save to</span>
          {isTauri && (
            <button type="button" className="settings-link" onClick={() => void detect()} disabled={folders === null}>
              <RefreshCw size={12} />
              Look again
            </button>
          )}
        </div>
        <div className="provider-list" role="radiogroup" aria-label="Save to">
          <ProviderRow
            selected={!autosave.root}
            onSelect={() => setAutosave({ root: null, provider: null, label: '' })}
            icon={<span className="provider-icon off">–</span>}
            title="Off"
            detail={shortcut('Save with ⌘S, as before.')}
          />
          {PROVIDERS.map((p) => {
            const icon = (
              <span className="provider-icon" style={{ background: p.color }}>
                {p.icon}
              </span>
            )
            if (folders === null) return <ProviderRow key={p.id} icon={icon} title={p.name} detail={<Spinner size={12} />} disabled />
            const found = folders.filter((f) => f.provider === p.id)
            // A folder chosen earlier that isn't there any more (its app was removed) stays listed.
            const lost = autosave.provider === p.id && !found.some((f) => f.path === autosave.root)
            if (!found.length && !lost) {
              return <ProviderRow key={p.id} icon={icon} title={p.name} detail={isTauri ? `Not found on this computer. ${p.app}` : 'Available in the Workspace app.'} disabled />
            }
            return [
              ...found.map((f) => (
                <ProviderRow
                  key={f.path}
                  icon={icon}
                  title={f.label}
                  detail={tildify(f.path)}
                  selected={autosave.root === f.path}
                  onSelect={() => setAutosave({ root: f.path, provider: f.provider, label: f.label })}
                />
              )),
              lost && <ProviderRow key="lost" icon={icon} title={autosave.label} detail={`Not found at ${tildify(autosave.root!)}`} selected warn />,
            ]
          })}
          <ProviderRow
            icon={
              <span className="provider-icon folder">
                <Folder size={15} strokeWidth={1.75} />
              </span>
            }
            title={autosave.provider === 'folder' ? autosave.label : 'Another folder…'}
            detail={autosave.provider === 'folder' ? tildify(autosave.root!) : 'Any folder a sync app watches, or a network drive.'}
            selected={autosave.provider === 'folder'}
            onSelect={() => void chooseFolder()}
            disabled={!isTauri}
          />
        </div>
      </div>

      <fieldset className="settings-fields" disabled={!autosave.root}>
        <div className="settings-row">
          <div className="settings-row-text">
            <span className="settings-label">Folder for new documents</span>
            <span className="settings-hint" title={folder ?? undefined}>
              {folder ? tildify(folder) : 'Choose where to save first.'}
            </span>
          </div>
          <div className="settings-row-control">
            <label className="field subfolder-field">
              <input
                value={autosave.subfolder}
                spellCheck={false}
                aria-label="Folder name"
                placeholder="Top level"
                onChange={(e) => setAutosave({ subfolder: e.currentTarget.value.replace(/[\\/:*?"<>|]/g, '') })}
              />
            </label>
            {isTauri && folder && folderExists && (
              <IconButton label={revealLabel} onClick={() => void revealInFinder(folder)}>
                <FolderOpen size={15} />
              </IconButton>
            )}
          </div>
        </div>

        <div className="settings-row">
          <div className="settings-row-text">
            <span className="settings-label">Save after you stop editing for</span>
            <span className="settings-hint">If you keep going, it still saves every 30 seconds.</span>
          </div>
          <div className="settings-row-control">
            <Segmented value={String(autosave.delay)} options={DELAYS} onChange={(v) => setAutosave({ delay: Number(v) })} disabled={!autosave.root} />
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

        <div className="settings-row">
          <div className="settings-row-text">
            <span className="settings-label">Also autosave files stored elsewhere</span>
            <span className="settings-hint">
              Files you open from outside {autosave.label || 'the cloud folder'} are saved where they are, not copied. When this is off, save them with{' '}
              {shortcut('⌘S')}.
            </span>
          </div>
          <div className="settings-row-control">
            <Switch label="Also autosave files stored elsewhere" checked={autosave.everywhere} onChange={(everywhere) => setAutosave({ everywhere })} />
          </div>
        </div>
      </fieldset>
    </>
  )
}

function ProviderRow({
  icon,
  title,
  detail,
  selected = false,
  disabled = false,
  warn = false,
  onSelect,
}: {
  icon: ReactNode
  title: string
  detail: ReactNode
  selected?: boolean
  disabled?: boolean
  warn?: boolean
  onSelect?: () => void
}) {
  return (
    <button type="button" role="radio" aria-checked={selected} className={`provider-row ${selected ? 'on' : ''}`} disabled={disabled} onClick={onSelect}>
      {icon}
      <span className="provider-text">
        <span className="provider-title">{title}</span>
        <span className={`provider-detail ${warn ? 'warn' : ''}`}>{detail}</span>
      </span>
      <span className="radio-dot" aria-hidden />
    </button>
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

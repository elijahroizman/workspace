import { Check } from 'lucide-react'
import { useEffect, useState } from 'react'
import { canSetDefaults, defaultStatus, makeDefault } from '../lib/defaults'
import { isMac, shortcut, showError } from '../lib/platform'
import { PLUGINS, isBuiltIn } from '../plugins/catalog'
import { usePlugins } from '../state/plugins'
import { useSetup } from '../state/setup'
import { keysFor } from '../state/shortcuts'
import { useWorkspace } from '../state/workspace'
import { PluginRow } from './PluginList'
import { DocBadge } from './Workbench'
import { Spinner } from './ui'

type Step = 'plugins' | 'defaults' | 'done'

/**
 * The first-launch screen (and Settings › General › Run setup again): which plugins to use,
 * and which file types Workspace should open when you double-click them.
 */
export default function SetupScreen() {
  const enabled = usePlugins((s) => s.enabled)
  const progress = usePlugins((s) => s.progress)
  const [step, setStep] = useState<Step>('plugins')
  const [plugins, setPlugins] = useState<Record<string, boolean>>(() => ({ ...enabled }))
  const [defaults, setDefaults] = useState<Record<string, boolean>>({})
  const [already, setAlready] = useState<Record<string, boolean | null>>({})
  const [busy, setBusy] = useState(false)
  const [windowsNote, setWindowsNote] = useState(false)

  const chosen = PLUGINS.filter((p) => isBuiltIn(p) || plugins[p.id])
  const kinds = chosen.flatMap((p) => p.kinds)
  const steps: Step[] = canSetDefaults ? ['plugins', 'defaults', 'done'] : ['plugins', 'done']

  useEffect(() => {
    if (step !== 'defaults') return
    void defaultStatus(kinds.map((k) => k.id)).then(setAlready, () => {})
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [step])

  const applyPlugins = async () => {
    setBusy(true)
    const { enable, disable } = usePlugins.getState()
    const openKinds = new Set(useWorkspace.getState().tabs.map((t) => t.kind))
    try {
      for (const plugin of PLUGINS.filter((p) => !isBuiltIn(p))) {
        const want = !!plugins[plugin.id]
        if (want && !enabled[plugin.id] && !(await enable(plugin.id))) {
          // The row shows why; stay here so it can be tried again or unticked.
          return
        }
        if (!want && enabled[plugin.id] && !plugin.kinds.some((k) => openKinds.has(k.id))) await disable(plugin.id)
      }
      setStep(steps[steps.indexOf('plugins') + 1])
    } finally {
      setBusy(false)
    }
  }

  const applyDefaults = async () => {
    const ids = kinds.filter((k) => defaults[k.id] && !already[k.id]).map((k) => k.id)
    if (ids.length) {
      setBusy(true)
      try {
        setWindowsNote(await makeDefault(ids))
      } catch (err) {
        await showError(String(err))
        return
      } finally {
        setBusy(false)
      }
    }
    setStep('done')
  }

  return (
    <div className="setup-backdrop">
      <div className="setup" role="dialog" aria-modal="true" aria-labelledby="setup-title">
        <ol className="setup-steps" aria-label="Steps">
          {steps.map((s, i) => (
            <li key={s} className={s === step ? 'on' : steps.indexOf(step) > i ? 'past' : ''}>
              {steps.indexOf(step) > i ? <Check size={11} strokeWidth={3} /> : i + 1}
            </li>
          ))}
        </ol>

        {step === 'plugins' && (
          <>
            <header className="setup-header">
              <h1 id="setup-title">Welcome to Workspace</h1>
              <p className="muted">Word, PowerPoint, PDF, Markdown, text and images are built in. Pick anything else you’d like to open.</p>
            </header>
            <div className="setup-body">
              {PLUGINS.filter((p) => !isBuiltIn(p)).map((p) => (
                <PluginRow
                  key={p.id}
                  plugin={p}
                  control={
                    progress[p.id] ? (
                      <Spinner size={16} />
                    ) : (
                      <input
                        type="checkbox"
                        className="setup-check"
                        aria-label={`Use ${p.name}`}
                        checked={!!plugins[p.id]}
                        disabled={busy}
                        onChange={(e) => setPlugins({ ...plugins, [p.id]: e.currentTarget.checked })}
                      />
                    )
                  }
                />
              ))}
              <div className="setup-builtins">
                {PLUGINS.filter(isBuiltIn)
                  .flatMap((p) => p.kinds)
                  .map((k) => (
                    <span key={k.id} className="setup-builtin">
                      <DocBadge kind={k.id} size={18} />
                      {k.prose === 'text' ? 'Text' : k.prose === 'image' ? 'Image' : k.prose}
                    </span>
                  ))}
                <span className="faint">Built in</span>
              </div>
              <p className="settings-hint">You can change this any time in Settings › Plugins.</p>
            </div>
            <footer className="setup-footer">
              <button type="button" className="btn primary" disabled={busy} onClick={() => void applyPlugins()}>
                {busy ? 'Downloading…' : 'Continue'}
              </button>
            </footer>
          </>
        )}

        {step === 'defaults' && (
          <>
            <header className="setup-header">
              <h1 id="setup-title">Open files with Workspace?</h1>
              <p className="muted">
                {isMac
                  ? 'Tick the file types Workspace should open when you double-click them in Finder.'
                  : 'Tick the file types Workspace should open when you double-click them. Windows will ask you to confirm in Settings.'}
              </p>
            </header>
            <div className="setup-body">
              <div className="setup-defaults">
                {kinds.map((k) => (
                  <label key={k.id} className="setup-default">
                    <input
                      type="checkbox"
                      className="setup-check"
                      checked={!!already[k.id] || !!defaults[k.id]}
                      disabled={!!already[k.id] || busy}
                      onChange={(e) => setDefaults({ ...defaults, [k.id]: e.currentTarget.checked })}
                    />
                    <DocBadge kind={k.id} size={24} />
                    <span className="setup-default-name">
                      {k.label}
                      <span className="faint"> {k.extensions.map((e) => `.${e}`).join(' ')}</span>
                    </span>
                    {already[k.id] && <span className="faint">Already opens in Workspace</span>}
                  </label>
                ))}
              </div>
              <div>
                <button
                  type="button"
                  className="link-btn"
                  disabled={busy}
                  onClick={() => setDefaults(Object.fromEntries(kinds.map((k) => [k.id, !kinds.every((x) => defaults[x.id] || already[x.id])])))}
                >
                  {kinds.every((k) => defaults[k.id] || already[k.id]) ? 'Untick all' : 'Tick all'}
                </button>
              </div>
            </div>
            <footer className="setup-footer">
              <button type="button" className="btn" disabled={busy} onClick={() => setStep('plugins')}>
                Back
              </button>
              <button type="button" className="btn primary" disabled={busy} onClick={() => void applyDefaults()}>
                {kinds.some((k) => defaults[k.id] && !already[k.id]) ? 'Set as default' : 'Skip'}
              </button>
            </footer>
          </>
        )}

        {step === 'done' && (
          <>
            <header className="setup-header">
              <h1 id="setup-title">You’re all set</h1>
              <p className="muted">
                {windowsNote
                  ? 'In the Settings window that opened, choose Workspace for each file type. Everything else is ready.'
                  : `Open a file, drop one on the window, or press ${shortcut(keysFor('new') || '⌘N')} to start something new.`}
              </p>
            </header>
            <footer className="setup-footer">
              <button type="button" className="btn primary" autoFocus onClick={() => useSetup.getState().finish()}>
                Start using Workspace
              </button>
            </footer>
          </>
        )}
      </div>
    </div>
  )
}

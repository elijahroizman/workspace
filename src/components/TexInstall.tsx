// Offered when the LaTeX plugin needs TeX and the system has none.

import { useEffect } from 'react'
import { formatSize } from '../state/plugins'
import { INSTALL_CHOICES, useTex } from '../state/tex'
import { Spinner } from './ui'

export function TexInstall() {
  const installing = useTex((s) => s.installing)
  const error = useTex((s) => s.error)
  const { install, close } = useTex.getState()

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return
      e.preventDefault()
      e.stopPropagation()
      close()
    }
    window.addEventListener('keydown', onKey, true)
    return () => window.removeEventListener('keydown', onKey, true)
  }, [close])

  const stage =
    installing?.stage === 'download'
      ? installing.total
        ? `Downloading… ${formatSize(installing.received)} of ${formatSize(installing.total)}`
        : 'Downloading…'
      : installing?.stage === 'verify'
        ? 'Checking the installer’s signature…'
        : installing
          ? 'Installing… this can take several minutes.'
          : null

  return (
    <div className="new-file-backdrop tex-install-backdrop" onMouseDown={(e) => e.target === e.currentTarget && close()}>
      <div className="tex-install" role="dialog" aria-modal="true" aria-labelledby="tex-install-title">
        <h2 id="tex-install-title">Install TeX for LaTeX documents?</h2>
        <p className="muted">
          Workspace compiles LaTeX with the TeX on your computer, and it doesn’t have one yet. You can install it now, or later from Settings › Plugins.
        </p>
        {INSTALL_CHOICES.length === 0 && <p className="muted">Install TeX Live with your system’s package manager, then reopen the document.</p>}
        {!installing && (
          <div className="tex-install-choices">
            {INSTALL_CHOICES.map((c, i) => (
              <button key={c.variant} type="button" className={`tex-install-choice ${i === 0 ? 'primary' : ''}`} onClick={() => void install(c.variant)}>
                <span className="settings-label">
                  {c.name} <span className="faint">· {c.size}</span>
                </span>
                <span className="settings-hint">{c.hint}</span>
              </button>
            ))}
          </div>
        )}
        {installing && (
          <div className="tex-install-progress">
            <Spinner size={16} />
            <span>{stage}</span>
          </div>
        )}
        {installing?.stage === 'download' && installing.total > 0 && (
          <span className="plugin-progress" role="progressbar" aria-valuemin={0} aria-valuemax={installing.total} aria-valuenow={installing.received}>
            <span style={{ width: `${Math.min(100, (100 * installing.received) / installing.total)}%` }} />
          </span>
        )}
        {error && <p className="plugin-error">{error}</p>}
        <div className="tex-install-actions">
          <button type="button" className="btn" onClick={close} disabled={!!installing}>
            {error ? 'Close' : 'Not now'}
          </button>
        </div>
      </div>
    </div>
  )
}

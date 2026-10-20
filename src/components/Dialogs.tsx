import { CircleAlert, Info, TriangleAlert } from 'lucide-react'
import { useEffect, useRef } from 'react'
import { answerDialog, useDialogs } from '../lib/dialogs'
import { Button, Modal } from './ui'

const ICONS = { info: Info, warning: TriangleAlert, error: CircleAlert }

let box: HTMLDivElement | null = null

// Added when this module loads, before any component's own listener, so while a dialog is up
// nothing else (Settings' Escape, editors, app shortcuts) sees the keys.
window.addEventListener(
  'keydown',
  (e) => {
    const current = useDialogs.getState().queue[0]
    if (!current) return
    e.stopImmediatePropagation()
    const inBox = document.activeElement instanceof HTMLButtonElement && !!box?.contains(document.activeElement)
    if (e.key === 'Escape') {
      e.preventDefault()
      answerDialog(current.id, current.cancelValue)
    } else if (e.key === 'Enter' && !inBox) {
      e.preventDefault()
      const primary = current.buttons.find((b) => b.primary && !b.danger)
      if (primary) answerDialog(current.id, primary.value)
    } else if (e.key === 'Tab') {
      // Focus stays on the dialog's buttons.
      e.preventDefault()
      const buttons = [...(box?.querySelectorAll('button') ?? [])]
      if (!buttons.length) return
      const at = buttons.indexOf(document.activeElement as HTMLButtonElement)
      buttons[(at + (e.shiftKey ? -1 : 1) + buttons.length) % buttons.length].focus()
    } else if (!inBox || (e.key !== ' ' && e.key !== 'Enter')) {
      e.preventDefault()
    }
  },
  true,
)

/** The app's own message box (lib/dialogs.ts): the first question in the queue. */
export function Dialogs() {
  const current = useDialogs((s) => s.queue[0])
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!current) return
    box = ref.current
    const focused = document.activeElement instanceof HTMLElement ? document.activeElement : null
    // The highlighted button, unless it's destructive (Revert, Delete): then Cancel, so Enter
    // can't throw anything away by accident.
    const start =
      ref.current?.querySelector<HTMLButtonElement>('button.primary:not(.danger)') ??
      ref.current?.querySelector<HTMLButtonElement>('button:not(.danger)') ??
      ref.current?.querySelector<HTMLButtonElement>('button')
    start?.focus()
    return () => {
      box = null
      if (focused?.isConnected) focused.focus()
    }
  }, [current])

  if (!current) return null
  const Icon = ICONS[current.kind]
  return (
    <Modal placement="top" dim="light" layer="dialog" onClose={() => answerDialog(current.id, current.cancelValue)}>
      <div
        ref={ref}
        className={`dialog dialog-${current.kind}`}
        role={current.kind === 'info' ? 'dialog' : 'alertdialog'}
        aria-modal="true"
        aria-labelledby={`dialog-title-${current.id}`}
        aria-describedby={current.message ? `dialog-message-${current.id}` : undefined}
      >
        <div className="dialog-body">
          <Icon size={20} className="dialog-icon" />
          <div className="dialog-text">
            <h2 id={`dialog-title-${current.id}`}>{current.title}</h2>
            {current.message && <p id={`dialog-message-${current.id}`}>{current.message}</p>}
          </div>
        </div>
        <div className="dialog-actions">
          {current.buttons.map((b) => (
            <Button
              key={b.value}
              variant={b.primary ? (b.danger ? 'primary-danger' : 'primary') : b.danger ? 'danger' : 'default'}
              onClick={() => answerDialog(current.id, b.value)}
            >
              {b.label}
            </Button>
          ))}
        </div>
      </div>
    </Modal>
  )
}

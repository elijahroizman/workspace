import { AlignVerticalJustifyCenter, Minimize2, SunDim } from 'lucide-react'
import { useEffect, useState } from 'react'
import { shortcut } from '../lib/platform'
import { dimming, useFocus } from '../state/focus'
import { withKeys } from '../state/shortcuts'

/** Where typewriter scrolling keeps the caret: this far down the visible area. */
const TYPEWRITER_LINE = 0.45

/** Word paragraphs carry their id on every piece (a paragraph split across pages has two). */
let paragraphStyle: HTMLStyleElement | null = null
function dimAllBut(id: string | null) {
  paragraphStyle ??= document.head.appendChild(document.createElement('style'))
  paragraphStyle.textContent = id
    ? `.app[data-focus-dim] .view[data-active='true'] .docx-page-content [data-paragraph-id]:not([data-paragraph-id="${CSS.escape(id)}"]) { opacity: 0.3; }`
    : ''
}

function scrollParent(el: HTMLElement): HTMLElement | null {
  for (let n = el.parentElement; n; n = n.parentElement) {
    const { overflowY } = getComputedStyle(n)
    if ((overflowY === 'auto' || overflowY === 'scroll') && n.scrollHeight > n.clientHeight) return n
  }
  return null
}

/** The caret's box. An empty line has no text to measure, so fall back to the line itself. */
function caretRect(sel: Selection, el: HTMLElement): DOMRect | null {
  const range = sel.getRangeAt(0)
  const rect = range.getClientRects()[0] ?? range.getBoundingClientRect()
  if (rect && rect.height > 0) return rect
  const line = el.closest<HTMLElement>('.docx-line, .cm-line') ?? el
  return line.getBoundingClientRect()
}

/**
 * Follows the caret for typewriter scrolling and paragraph dimming, and shows focus mode's
 * controls along the top while the pointer is up there.
 */
export function FocusMode() {
  const on = useFocus((s) => s.on)
  const typewriter = useFocus((s) => s.typewriter)
  const dim = useFocus(dimming)
  const [awake, setAwake] = useState(false)

  useEffect(() => {
    if (!typewriter && !dim) return
    let frame = 0
    const apply = () => {
      const sel = window.getSelection()
      if (!sel?.rangeCount || !sel.focusNode) return
      const node = sel.focusNode
      const el = node instanceof HTMLElement ? node : node.parentElement
      // Only the document in front: not a field in the inspector, not a background tab.
      if (!el?.closest(".view[data-active='true'] .canvas") || el.closest('input, textarea, .find-bar')) return
      if (dim) {
        const paragraph = el.closest('[data-paragraph-id]')
        if (paragraph) dimAllBut(paragraph.getAttribute('data-paragraph-id'))
      }
      // A drag that selects text shouldn't scroll under the pointer.
      if (typewriter && sel.isCollapsed) {
        const rect = caretRect(sel, el)
        const scroller = scrollParent(el)
        if (!rect || !scroller) return
        const box = scroller.getBoundingClientRect()
        const delta = rect.top + rect.height / 2 - (box.top + box.height * TYPEWRITER_LINE)
        if (Math.abs(delta) > 3) scroller.scrollBy({ top: delta, behavior: 'smooth' })
      }
    }
    const update = () => {
      cancelAnimationFrame(frame)
      frame = requestAnimationFrame(apply)
    }
    document.addEventListener('selectionchange', update)
    document.addEventListener('input', update, true)
    update()
    return () => {
      cancelAnimationFrame(frame)
      document.removeEventListener('selectionchange', update)
      document.removeEventListener('input', update, true)
    }
  }, [typewriter, dim])

  useEffect(() => {
    if (!dim) dimAllBut(null)
  }, [dim])

  // The controls show while the pointer is near the top of the window.
  useEffect(() => {
    if (!on) return
    let timer = 0
    const onMove = (e: PointerEvent) => {
      if (e.clientY > 110) return
      setAwake(true)
      window.clearTimeout(timer)
      timer = window.setTimeout(() => setAwake(false), 1800)
    }
    window.addEventListener('pointermove', onMove)
    return () => {
      window.removeEventListener('pointermove', onMove)
      window.clearTimeout(timer)
      setAwake(false)
    }
  }, [on])

  if (!on) return null
  const state = useFocus.getState()
  return (
    <div className={`focus-hud ${awake ? 'awake' : ''}`} role="toolbar" aria-label="Focus mode">
      <span className="focus-hud-label">Focus</span>
      <button type="button" className={`focus-hud-btn ${typewriter ? 'on' : ''}`} aria-pressed={typewriter} title={shortcut(withKeys('Typewriter scrolling', 'typewriter'))} onClick={state.toggleTypewriter}>
        <AlignVerticalJustifyCenter size={14} />
        Typewriter
      </button>
      <button type="button" className={`focus-hud-btn ${state.dim ? 'on' : ''}`} aria-pressed={state.dim} title={shortcut(withKeys('Dim other paragraphs', 'focus-dim'))} onClick={state.toggleDim}>
        <SunDim size={14} />
        Dim
      </button>
      <span className="sep" />
      <button type="button" className="focus-hud-btn" title={shortcut(withKeys('Leave focus mode', 'focus-mode'))} onClick={() => state.setOn(false)}>
        <Minimize2 size={14} />
        Exit
      </button>
    </div>
  )
}

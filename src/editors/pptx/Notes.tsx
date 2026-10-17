import { useEffect, useRef, useState } from 'react'
import type { Slide } from './types'

/**
 * Speaker notes for the slide on screen, under the canvas as in PowerPoint. Typing is saved
 * shortly after it pauses (one undo step per pause) and when the box loses focus.
 */
export function NotesPane({ slide, onChange }: { slide: Slide; onChange: (notes: string) => void }) {
  const [text, setText] = useState(slide.notes ?? '')
  const pending = useRef<string | null>(null)
  const timer = useRef(0)
  const save = useRef(onChange)
  save.current = onChange
  // What the deck holds now; the cleanup below runs with the first render's closure.
  const saved = useRef(slide.notes ?? '')
  saved.current = slide.notes ?? ''

  const flush = () => {
    window.clearTimeout(timer.current)
    if (pending.current === null) return
    const value = pending.current
    pending.current = null
    if (value !== saved.current) {
      saved.current = value
      save.current(value)
    }
  }

  // Another slide, or an undo: show what the deck holds, unless there's typing still to save.
  useEffect(() => {
    if (pending.current === null) setText(slide.notes ?? '')
  }, [slide.notes, slide.id])

  // Save before switching slides; the pending text belongs to this one.
  useEffect(() => () => flush(), [slide.id]) // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <div className="notes-pane">
      <textarea
        aria-label="Speaker notes"
        placeholder="Click to add speaker notes"
        value={text}
        spellCheck
        onChange={(e) => {
          setText(e.currentTarget.value)
          pending.current = e.currentTarget.value
          window.clearTimeout(timer.current)
          timer.current = window.setTimeout(flush, 600)
        }}
        onBlur={flush}
        // The slide editor listens on the window for Delete, ⌘Z and the like.
        onKeyDown={(e) => {
          if (e.key === 'Escape') e.currentTarget.blur()
          e.stopPropagation()
        }}
      />
    </div>
  )
}

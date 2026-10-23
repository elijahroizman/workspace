// Under the box a formula is typed into: the functions whose names start with what's typed, or,
// inside a call, what the function takes with the current argument in bold.

import { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import type { SheetFunction } from '../../engine/sheets/functions'

export function FormulaHelp({
  anchor,
  items,
  index,
  call,
  onPick,
  onHover,
}: {
  anchor: HTMLElement
  /** Suggestions, or none to show the hint for `call`. */
  items: SheetFunction[]
  index: number
  call: { fn: SheetFunction; arg: number } | null
  onPick: (fn: SheetFunction) => void
  onHover: (index: number) => void
}) {
  const r = anchor.getBoundingClientRect()
  const below = window.innerHeight - r.bottom > 260
  const style: React.CSSProperties = { left: Math.max(4, Math.min(r.left, window.innerWidth - 340)), ...(below ? { top: r.bottom + 4 } : { bottom: window.innerHeight - r.top + 4 }) }
  const selected = items[index]
  // The hint alone lets clicks through to the cells under it, and fades while the mouse is over it.
  const hintOnly = items.length === 0
  const box = useRef<HTMLDivElement>(null)
  const [under, setUnder] = useState(false)
  useEffect(() => {
    if (!hintOnly) return setUnder(false)
    const move = (e: MouseEvent) => {
      const b = box.current?.getBoundingClientRect()
      setUnder(!!b && e.clientX >= b.left && e.clientX <= b.right && e.clientY >= b.top && e.clientY <= b.bottom)
    }
    window.addEventListener('mousemove', move)
    return () => window.removeEventListener('mousemove', move)
  }, [hintOnly])
  return createPortal(
    <div ref={box} className={`formula-help ${hintOnly ? 'hint' : ''} ${under ? 'under' : ''}`} style={style} onMouseDown={(e) => e.preventDefault()}>
      {items.length > 0 ? (
        <>
          <ul role="listbox" aria-label="Functions">
            {items.map((fn, i) => (
              <li
                key={fn.name}
                role="option"
                aria-selected={i === index}
                className={i === index ? 'on' : ''}
                ref={(el) => {
                  if (i === index) el?.scrollIntoView({ block: 'nearest' })
                }}
                onMouseEnter={() => onHover(i)}
                onClick={() => onPick(fn)}
              >
                <span className="formula-help-name">{fn.name}</span>
                <span className="formula-help-group">{fn.group}</span>
              </li>
            ))}
          </ul>
          {selected && (
            <div className="formula-help-about">
              <Signature fn={selected} arg={-1} />
              <span>{selected.about}</span>
              <span className="faint">Tab to insert</span>
            </div>
          )}
        </>
      ) : (
        call && (
          <div className="formula-help-about">
            <Signature fn={call.fn} arg={call.arg} />
            <span>{call.fn.about}</span>
          </div>
        )
      )}
    </div>,
    document.body,
  )
}

/** `VLOOKUP(lookup_value, table_array, …)` with argument `arg` in bold. */
function Signature({ fn, arg }: { fn: SheetFunction; arg: number }) {
  // Repeating arguments (`…`) keep the last named one bold past the end.
  const named = fn.args.filter((a) => a !== '…').length
  const repeats = fn.args.includes('…')
  const current = repeats && arg >= named ? named - 1 : arg
  return (
    <code className="formula-help-sig">
      {fn.name}(
      {fn.args.map((a, i) => (
        <span key={i}>
          {i > 0 && ', '}
          {i === current ? <b>{a}</b> : a}
        </span>
      ))}
      )
    </code>
  )
}

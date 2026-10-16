import { ChevronDown, ChevronRight } from 'lucide-react'
import type { ButtonHTMLAttributes, ReactNode } from 'react'
import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { shortcut } from '../lib/platform'

export function IconButton({
  label,
  active,
  size,
  children,
  className = '',
  ...rest
}: ButtonHTMLAttributes<HTMLButtonElement> & { label: string; active?: boolean; size?: 'sm' }) {
  const text = shortcut(label)
  return (
    <button
      type="button"
      aria-label={text}
      title={text}
      aria-pressed={active}
      className={`icon-btn ${active ? 'active' : ''} ${size ?? ''} ${className}`}
      {...rest}
    >
      {children}
    </button>
  )
}

export function Section({
  title,
  actions,
  children,
  collapsible = false,
  defaultOpen = true,
  flush = false,
}: {
  title: ReactNode
  actions?: ReactNode
  children?: ReactNode
  collapsible?: boolean
  defaultOpen?: boolean
  flush?: boolean
}) {
  const [open, setOpen] = useState(defaultOpen)
  return (
    <section className={`section ${open ? '' : 'collapsed'}`}>
      <header className="section-header">
        {collapsible ? (
          <button type="button" className="section-title" onClick={() => setOpen(!open)} aria-expanded={open}>
            {open ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
            {title}
          </button>
        ) : (
          <span className="section-title">{title}</span>
        )}
        {actions}
      </header>
      {open && children && <div className={`section-body ${flush ? 'flush' : ''}`}>{children}</div>}
    </section>
  )
}

export function Segmented<T extends string>({
  value,
  options,
  onChange,
  disabled,
}: {
  value: T | null
  options: { value: T; label?: ReactNode; icon?: ReactNode; title?: string }[]
  onChange: (value: T) => void
  disabled?: boolean
}) {
  return (
    <div className="segmented" role="radiogroup">
      {options.map((o) => (
        <button
          key={o.value}
          type="button"
          role="radio"
          aria-checked={value === o.value}
          title={shortcut(o.title ?? (typeof o.label === 'string' ? o.label : ''))}
          aria-label={shortcut(o.title ?? (typeof o.label === 'string' ? o.label : o.value))}
          className={value === o.value ? 'on' : ''}
          disabled={disabled}
          onClick={() => onChange(o.value)}
        >
          {o.icon}
          {o.label}
        </button>
      ))}
    </div>
  )
}

/** Numeric input that commits on Enter/blur, with arrow-key nudging (⇧ for ×10). */
export function NumberField({
  label,
  value,
  onCommit,
  suffix,
  step = 1,
  precision = 0,
  disabled,
  min,
  max,
}: {
  label: ReactNode
  value: number | null
  onCommit: (value: number) => void
  suffix?: string
  step?: number
  precision?: number
  disabled?: boolean
  min?: number
  max?: number
}) {
  const format = (v: number | null) => (v == null || Number.isNaN(v) ? '' : String(Number(v.toFixed(precision))))
  const [text, setText] = useState(format(value))
  const focused = useRef(false)

  useEffect(() => {
    if (!focused.current) setText(format(value))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value])

  const clamp = (v: number) => Math.min(max ?? Infinity, Math.max(min ?? -Infinity, v))
  const commit = (raw: string) => {
    const parsed = Number(raw.replace(/[^0-9.+-]/g, ''))
    if (raw.trim() === '' || Number.isNaN(parsed)) {
      setText(format(value))
      return
    }
    const next = clamp(parsed)
    setText(format(next))
    if (next !== value) onCommit(next)
  }

  return (
    <label className="field">
      <span className="field-label">{label}</span>
      <input
        value={text}
        disabled={disabled}
        inputMode="decimal"
        onFocus={(e) => {
          focused.current = true
          e.currentTarget.select()
        }}
        onBlur={(e) => {
          focused.current = false
          commit(e.currentTarget.value)
        }}
        onChange={(e) => setText(e.currentTarget.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter') {
            commit(e.currentTarget.value)
            e.currentTarget.blur()
          } else if (e.key === 'Escape') {
            setText(format(value))
            e.currentTarget.blur()
          } else if (e.key === 'ArrowUp' || e.key === 'ArrowDown') {
            e.preventDefault()
            const delta = (e.key === 'ArrowUp' ? step : -step) * (e.shiftKey ? 10 : 1)
            const next = clamp((value ?? 0) + delta)
            setText(format(next))
            onCommit(next)
          }
        }}
      />
      {suffix && <span className="field-suffix">{suffix}</span>}
    </label>
  )
}

export function SelectField({
  label,
  value,
  options,
  onChange,
  disabled,
  placeholder,
}: {
  label?: ReactNode
  value: string | null
  options: { value: string; label: string }[]
  onChange: (value: string) => void
  disabled?: boolean
  placeholder?: string
}) {
  const known = value != null && options.some((o) => o.value === value)
  const select = useRef<HTMLSelectElement>(null)
  return (
    <label
      className="field"
      onMouseDown={(e) => {
        // A click on the label beside the list should open it, not just focus it.
        const el = select.current
        if (!el || disabled || e.target === el) return
        e.preventDefault()
        el.focus()
        try {
          el.showPicker()
        } catch {
          // Older WebKit has no showPicker for selects; the list stays focused for the keyboard.
        }
      }}
    >
      {label && <span className="field-label">{label}</span>}
      <select ref={select} value={known ? value! : ''} disabled={disabled} onChange={(e) => onChange(e.currentTarget.value)}>
        {!known && <option value="">{value ?? placeholder ?? '—'}</option>}
        {options.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </select>
      <ChevronDown size={14} className="chevron" />
    </label>
  )
}

export function ColorField({
  value,
  onChange,
  label,
  disabled,
}: {
  value: string | null
  onChange: (hex: string) => void
  label?: string
  disabled?: boolean
}) {
  const hex = normalizeHex(value)
  const [text, setText] = useState(hex ?? '')
  useEffect(() => setText(hex ?? ''), [hex])
  return (
    <label className="field">
      <span className="color-input" style={{ background: hex ? `#${hex}` : 'transparent' }}>
        <input
          type="color"
          disabled={disabled}
          value={`#${hex ?? '000000'}`}
          onChange={(e) => onChange(e.currentTarget.value.slice(1).toUpperCase())}
        />
      </span>
      <input
        value={text}
        disabled={disabled}
        placeholder={label ?? 'Mixed'}
        spellCheck={false}
        onChange={(e) => setText(e.currentTarget.value)}
        onBlur={(e) => {
          const next = normalizeHex(e.currentTarget.value)
          if (next && next !== hex) onChange(next)
          else setText(hex ?? '')
        }}
        onKeyDown={(e) => {
          if (e.key === 'Enter') e.currentTarget.blur()
        }}
      />
    </label>
  )
}

export function normalizeHex(value: string | null | undefined): string | null {
  if (!value) return null
  let v = value.trim().replace(/^#/, '')
  if (/^[0-9a-f]{3}$/i.test(v)) v = v.replace(/./g, (c) => c + c)
  return /^[0-9a-f]{6}$/i.test(v) ? v.toUpperCase() : null
}

export interface MenuEntry {
  label: string
  icon?: ReactNode
  shortcut?: string
  onSelect: () => void
  separatorBefore?: boolean
  danger?: boolean
}

/** A small popover menu anchored to a point or element. */
export function PopoverMenu({
  anchor,
  items,
  onClose,
}: {
  anchor: { x: number; y: number }
  items: MenuEntry[]
  onClose: () => void
}) {
  const ref = useRef<HTMLDivElement>(null)
  const [pos, setPos] = useState(anchor)

  useLayoutEffect(() => {
    const el = ref.current
    if (!el) return
    const { innerWidth, innerHeight } = window
    const rect = el.getBoundingClientRect()
    setPos({
      x: Math.min(anchor.x, innerWidth - rect.width - 8),
      y: anchor.y + rect.height > innerHeight - 8 ? Math.max(8, anchor.y - rect.height) : anchor.y,
    })
  }, [anchor])

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose()
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  return createPortal(
    <>
      <div className="menu-backdrop" onMouseDown={onClose} onContextMenu={(e) => (e.preventDefault(), onClose())} />
      <div className="menu" ref={ref} style={{ left: pos.x, top: pos.y }} role="menu">
        {items.map((item, i) => (
          <div key={i}>
            {item.separatorBefore && <div className="menu-sep" />}
            <button
              type="button"
              role="menuitem"
              className="menu-item"
              style={item.danger ? { color: 'var(--danger)' } : undefined}
              onClick={() => {
                onClose()
                item.onSelect()
              }}
            >
              {item.icon}
              <span className="label">{item.label}</span>
              {item.shortcut && <span className="kbd">{shortcut(item.shortcut)}</span>}
            </button>
          </div>
        ))}
      </div>
    </>,
    document.body,
  )
}

/**
 * Insert-table size picker. The grid grows as the pointer nears its edge, up to `max`,
 * so a big table is one sweep away without a huge empty grid up front.
 */
export function TableSizePicker({ onPick, max = { rows: 20, cols: 10 } }: { onPick: (rows: number, cols: number) => void; max?: { rows: number; cols: number } }) {
  const [hover, setHover] = useState({ rows: 0, cols: 0 })
  const rows = Math.min(max.rows, Math.max(6, hover.rows + 1))
  const cols = Math.min(max.cols, Math.max(6, hover.cols + 1))
  return (
    <div className="table-picker" onMouseLeave={() => setHover({ rows: 0, cols: 0 })}>
      <div className="table-picker-grid" style={{ gridTemplateColumns: `repeat(${cols}, 18px)` }}>
        {Array.from({ length: rows * cols }, (_, i) => {
          const r = Math.floor(i / cols) + 1
          const c = (i % cols) + 1
          return (
            <button
              key={`${r}-${c}`}
              type="button"
              aria-label={`${r} by ${c}`}
              className={r <= hover.rows && c <= hover.cols ? 'on' : ''}
              onMouseEnter={() => setHover({ rows: r, cols: c })}
              onFocus={() => setHover({ rows: r, cols: c })}
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => onPick(r, c)}
            />
          )
        })}
      </div>
      <span className="table-picker-caption">
        {hover.rows ? `${hover.rows} ${hover.rows === 1 ? 'row' : 'rows'} × ${hover.cols} ${hover.cols === 1 ? 'column' : 'columns'}` : 'Choose a size'}
      </span>
    </div>
  )
}

export function Spinner({ size = 18 }: { size?: number }) {
  return (
    <svg className="spin" width={size} height={size} viewBox="0 0 24 24" fill="none" aria-hidden>
      <circle cx="12" cy="12" r="9" stroke="currentColor" strokeOpacity="0.2" strokeWidth="2.5" />
      <path d="M21 12a9 9 0 0 0-9-9" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" />
    </svg>
  )
}

export function CenterState({ title, children, spinner }: { title?: string; children?: ReactNode; spinner?: boolean }) {
  return (
    <div className="center-state">
      <div className="box">
        {spinner && <Spinner size={22} />}
        {title && <h3>{title}</h3>}
        {children}
      </div>
    </div>
  )
}

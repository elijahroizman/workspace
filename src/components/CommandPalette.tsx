import { ArrowRight, Clock, Command, FileText } from 'lucide-react'
import type { ReactNode } from 'react'
import { useEffect, useMemo, useRef, useState } from 'react'
import { create } from 'zustand'
import { commandAvailable, runCommand } from '../App'
import { KINDS } from '../lib/kinds'
import { basename, dirname, shortcut, tildify } from '../lib/platform'
import { enabledKinds, usePlugins } from '../state/plugins'
import type { SettingsPage } from '../state/settings'
import { useSettings } from '../state/settings'
import type { Scope } from '../state/shortcuts'
import { SHORTCUTS, keysFor } from '../state/shortcuts'
import { getEditor, HOME_TAB_ID, useWorkspace } from '../state/workspace'
import { KindIcon } from './Workbench'

/**
 * ⇧⌘P: one box to find anything. Type to search commands, open tabs and recent files; start
 * with “>” for commands only. Arrows and return pick, esc closes.
 */
export const usePalette = create<{ open: boolean; query: string; setOpen(open: boolean, query?: string): void }>((set) => ({
  open: false,
  query: '',
  setOpen: (open, query = '') => set({ open, query }),
}))

export interface PaletteItem {
  id: string
  label: string
  /** Shown faintly after the label: a folder, a hint. */
  detail?: string
  group: 'Tabs' | 'Recent' | 'Commands'
  icon?: ReactNode
  keys?: string
  /** More words that should find it (“dark” finds Light or dark). */
  keywords?: string
  run(): void | Promise<void>
}

/** Commands that make no sense in a list you pick from (they're keys, or they're this). */
const HIDDEN = new Set(['command-palette', 'tab-number', 'fullscreen-mac'])

const SETTINGS_PAGES: { page: SettingsPage; label: string }[] = [
  { page: 'general', label: 'General' },
  { page: 'plugins', label: 'Plugins' },
  { page: 'autosave', label: 'Autosave' },
  { page: 'appearance', label: 'Appearance' },
  { page: 'shortcuts', label: 'Keyboard Shortcuts' },
]

const sentence = (s: string) => s.charAt(0).toUpperCase() + s.slice(1)

function commandItems(): PaletteItem[] {
  const ws = useWorkspace.getState()
  const tab = ws.tabs.find((t) => t.id === ws.activeId)
  const scope: Scope | null = tab?.kind === 'docx' || tab?.kind === 'pptx' ? tab.kind : null
  const editor = getEditor(ws.activeId)
  const items: PaletteItem[] = []

  for (const def of SHORTCUTS) {
    if (def.fixed || HIDDEN.has(def.id)) continue
    const keys = keysFor(def.id)
    if (def.scope === 'app') {
      if (!commandAvailable(def.id)) continue
      items.push({ id: `cmd:${def.id}`, label: sentence(def.label), group: 'Commands', keys, keywords: def.group, run: () => runCommand(def.id) })
      continue
    }
    // Editor commands, for the kind of document in front of you.
    const fits = def.scope === 'text' ? scope !== null : def.scope === scope
    const action = editor?.actions?.[def.id]
    if (!fits || !action) continue
    items.push({ id: `cmd:${def.id}`, label: sentence(def.label), group: 'Commands', keys, keywords: def.group, run: () => void action() })
  }

  for (const kind of enabledKinds(usePlugins.getState().enabled)) {
    if (!kind.create) continue
    items.push({
      id: `new:${kind.id}`,
      label: `${sentence(kind.create.title)} (${kind.create.hint})`,
      group: 'Commands',
      icon: <KindIcon kind={kind.id} />,
      keywords: `new create ${kind.label}`,
      run: () => ws.newDocument(kind.id),
    })
  }

  for (const mode of ['light', 'dark', 'system'] as const) {
    items.push({
      id: `theme:${mode}`,
      label: `Appearance: ${mode === 'system' ? 'match the system' : sentence(mode)}`,
      group: 'Commands',
      keywords: 'theme color mode',
      run: () => ws.setThemeMode(mode),
    })
  }
  for (const { page, label } of SETTINGS_PAGES) {
    items.push({ id: `settings:${page}`, label: `Settings: ${label}`, group: 'Commands', keywords: 'preferences options', run: () => useSettings.getState().setOpen(true, page) })
  }
  items.push({ id: 'check-updates', label: 'Check for updates…', group: 'Commands', keywords: 'version upgrade', run: () => runCommand('check-updates') })
  if (ws.recents.length) items.push({ id: 'clear-recents', label: 'Clear recent files', group: 'Commands', keywords: 'history', run: () => ws.clearRecents() })
  return items
}

function tabItems(): PaletteItem[] {
  const ws = useWorkspace.getState()
  const items: PaletteItem[] = [{ id: `tab:${HOME_TAB_ID}`, label: 'Home', group: 'Tabs', icon: <Command size={14} />, run: () => ws.activate(HOME_TAB_ID) }]
  for (const t of ws.tabs) {
    items.push({
      id: `tab:${t.id}`,
      label: t.title,
      detail: t.path && !t.path.startsWith('browser:') ? tildify(dirname(t.path)) : t.dirty ? 'Not saved' : undefined,
      group: 'Tabs',
      icon: <KindIcon kind={t.kind} />,
      run: () => ws.activate(t.id),
    })
  }
  return items.filter((i) => i.id !== `tab:${ws.activeId}`)
}

function recentItems(): PaletteItem[] {
  const ws = useWorkspace.getState()
  const open = new Set(ws.tabs.map((t) => t.path))
  return ws.recents
    .filter((r) => !open.has(r.path))
    .map((r) => ({
      id: `recent:${r.path}`,
      label: basename(r.path),
      detail: tildify(dirname(r.path)),
      group: 'Recent' as const,
      icon: KINDS[r.kind] ? <KindIcon kind={r.kind} /> : <FileText size={14} />,
      run: () => ws.openPaths([r.path]),
    }))
}

/** Extra items other parts of the app add (a folder's files). Read each time the palette opens. */
const sources: (() => PaletteItem[])[] = []
export function addPaletteSource(source: () => PaletteItem[]) {
  sources.push(source)
  return () => {
    const i = sources.indexOf(source)
    if (i !== -1) sources.splice(i, 1)
  }
}

/**
 * How well `query` matches `text`: its letters in order, scoring runs, word starts and an early
 * start. Null when they aren't all there. `at` lists the matched positions, for bold.
 */
export function fuzzy(query: string, text: string): { score: number; at: number[] } | null {
  const q = query.toLowerCase()
  const t = text.toLowerCase()
  if (!q) return { score: 0, at: [] }
  // A plain substring beats any scattered match.
  const sub = t.indexOf(q)
  if (sub !== -1) {
    const wordStart = sub === 0 || /[\s\-_./:(]/.test(t[sub - 1])
    return { score: 1000 - sub + (wordStart ? 200 : 0) - t.length * 0.1, at: Array.from({ length: q.length }, (_, i) => sub + i) }
  }
  const at: number[] = []
  let score = 0
  let ti = 0
  for (const ch of q) {
    if (ch === ' ') continue
    const found = t.indexOf(ch, ti)
    if (found === -1) return null
    const prev = at[at.length - 1]
    if (prev !== undefined && found === prev + 1) score += 15
    if (found === 0 || /[\s\-_./:(]/.test(t[found - 1])) score += 10
    score -= Math.min(found - ti, 10)
    at.push(found)
    ti = found + 1
  }
  return { score: score - t.length * 0.1, at }
}

function Highlight({ text, at }: { text: string; at: number[] }) {
  if (!at.length) return <>{text}</>
  const marks = new Set(at)
  const parts: ReactNode[] = []
  let run = ''
  let bold = false
  const flush = (i: number) => {
    if (run) parts.push(bold ? <b key={i}>{run}</b> : run)
    run = ''
  }
  for (let i = 0; i < text.length; i++) {
    const m = marks.has(i)
    if (m !== bold) {
      flush(i)
      bold = m
    }
    run += text[i]
  }
  flush(text.length)
  return <>{parts}</>
}

const GROUP_ICON = { Tabs: <ArrowRight size={14} />, Recent: <Clock size={14} />, Commands: <Command size={14} /> }

export function CommandPalette() {
  const initial = usePalette((s) => s.query)
  const [query, setQuery] = useState(initial)
  const [index, setIndex] = useState(0)
  const input = useRef<HTMLInputElement>(null)
  const list = useRef<HTMLDivElement>(null)
  const close = () => usePalette.getState().setOpen(false)

  // Gathered once per opening: what's open and possible doesn't change while you type.
  const all = useMemo(() => [...tabItems(), ...recentItems(), ...sources.flatMap((s) => s()), ...commandItems()], [])

  const onlyCommands = query.startsWith('>')
  const q = (onlyCommands ? query.slice(1) : query).trim()
  const shown = useMemo(() => {
    const pool = onlyCommands ? all.filter((i) => i.group === 'Commands') : all
    if (!q) {
      // Nothing typed: tabs, then a few recent files, then every command.
      let recent = 0
      return pool.filter((i) => i.group !== 'Recent' || recent++ < 5).map((item) => ({ item, at: [] as number[] }))
    }
    const scored: { item: PaletteItem; at: number[]; score: number }[] = []
    for (const item of pool) {
      const m = fuzzy(q, item.label)
      const extra = !m && item.keywords ? fuzzy(q, `${item.keywords} ${item.detail ?? ''}`) : null
      if (m) scored.push({ item, at: m.at, score: m.score + (item.group === 'Tabs' ? 30 : 0) })
      else if (extra) scored.push({ item, at: [], score: extra.score - 300 })
      else if (item.detail) {
        const d = fuzzy(q, item.detail)
        if (d && d.score > 0) scored.push({ item, at: [], score: d.score - 500 })
      }
    }
    return scored.sort((a, b) => b.score - a.score).slice(0, 80)
  }, [all, q, onlyCommands])

  useEffect(() => {
    input.current?.focus()
    input.current?.select()
  }, [])
  useEffect(() => setIndex(0), [query])
  useEffect(() => {
    list.current?.querySelector<HTMLElement>('[aria-selected="true"]')?.scrollIntoView({ block: 'nearest' })
  }, [index, shown])

  const pick = (item: PaletteItem | undefined) => {
    if (!item) return
    close()
    // After the palette is gone, so the command's own focus (a find box, a dialog) sticks.
    requestAnimationFrame(() => void item.run())
  }

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') close()
      else if (e.key === 'ArrowDown' || (e.ctrlKey && e.key === 'n')) setIndex((i) => Math.min(shown.length - 1, i + 1))
      else if (e.key === 'ArrowUp' || (e.ctrlKey && e.key === 'p')) setIndex((i) => Math.max(0, i - 1))
      else if (e.key === 'PageDown') setIndex((i) => Math.min(shown.length - 1, i + 8))
      else if (e.key === 'PageUp') setIndex((i) => Math.max(0, i - 8))
      else if (e.key === 'Enter') pick(shown[index]?.item)
      else return
      e.preventDefault()
      e.stopPropagation()
    }
    window.addEventListener('keydown', onKey, true)
    return () => window.removeEventListener('keydown', onKey, true)
  })

  return (
    <div className="palette-backdrop" onMouseDown={(e) => e.target === e.currentTarget && close()}>
      <div className="palette" role="dialog" aria-modal="true" aria-label="Command palette">
        <input
          ref={input}
          className="palette-input"
          value={query}
          placeholder="Search tabs, recent files and commands (> for commands only)"
          spellCheck={false}
          role="combobox"
          aria-expanded="true"
          aria-controls="palette-list"
          aria-activedescendant={shown[index] ? `palette-${index}` : undefined}
          onChange={(e) => setQuery(e.currentTarget.value)}
        />
        <div className="palette-list" id="palette-list" role="listbox" ref={list}>
          {shown.length === 0 && <div className="palette-empty">Nothing matches “{q}”.</div>}
          {shown.map(({ item, at }, i) => {
            const first = !q && (i === 0 || shown[i - 1].item.group !== item.group)
            return (
              <div key={item.id} role="presentation">
                {first && <div className="palette-group">{item.group}</div>}
                <button
                  id={`palette-${i}`}
                  type="button"
                  role="option"
                  aria-selected={i === index}
                  className={`palette-item ${i === index ? 'on' : ''}`}
                  onMouseMove={() => i !== index && setIndex(i)}
                  onClick={() => pick(item)}
                >
                  <span className="palette-icon">{item.icon ?? GROUP_ICON[item.group]}</span>
                  <span className="palette-label">
                    <Highlight text={item.label} at={at} />
                  </span>
                  {item.detail && <span className="palette-detail">{item.detail}</span>}
                  {q && <span className="palette-kind">{item.group === 'Commands' ? 'Command' : item.group === 'Tabs' ? 'Tab' : 'Recent'}</span>}
                  {item.keys && <span className="kbd">{shortcut(item.keys)}</span>}
                </button>
              </div>
            )
          })}
        </div>
      </div>
    </div>
  )
}

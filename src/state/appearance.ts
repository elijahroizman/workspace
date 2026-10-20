// Which color theme is used in light and in dark, and the user's own themes (see lib/themes.ts).
// The appearance itself (light, dark, or the system's) is `theme` in the workspace store.

import { create } from 'zustand'
import { isTauri, isWindows } from '../lib/platform'
import type { Appearance, ThemeDef } from '../lib/themes'
import { DEFAULT_THEME_ID, isHex, PRESET_THEMES, themeVars } from '../lib/themes'
import { useWorkspace } from './workspace'

const KEY = 'workspace.appearance'

interface AppearanceState {
  /** Theme ids for each appearance. */
  light: string
  dark: string
  custom: ThemeDef[]
  /** One appearance, or both when `mode` is omitted. */
  use(id: string, mode?: Appearance): void
  /** Adds a theme, or replaces the custom theme with the same id. */
  save(theme: ThemeDef): void
  remove(id: string): void
}

function load(): Pick<AppearanceState, 'light' | 'dark' | 'custom'> {
  const none = { light: DEFAULT_THEME_ID, dark: DEFAULT_THEME_ID, custom: [] }
  try {
    const parsed: unknown = JSON.parse(localStorage.getItem(KEY) || 'null')
    if (typeof parsed !== 'object' || parsed === null) return none
    const p = parsed as Record<string, unknown>
    const custom = (Array.isArray(p.custom) ? p.custom : [])
      .filter((t): t is ThemeDef => !!t && typeof t.id === 'string' && typeof t.name === 'string' && isHex(t.accent) && isHex(t.light) && isHex(t.dark))
      .map((t) => ({ id: t.id, name: t.name.slice(0, 40), accent: t.accent, light: t.light, dark: t.dark, custom: true }))
    const known = (id: unknown) => typeof id === 'string' && (PRESET_THEMES.some((t) => t.id === id) || custom.some((t) => t.id === id))
    return { light: known(p.light) ? (p.light as string) : DEFAULT_THEME_ID, dark: known(p.dark) ? (p.dark as string) : DEFAULT_THEME_ID, custom }
  } catch {
    return none
  }
}

export const useAppearance = create<AppearanceState>((set, get) => {
  const persist = () => {
    const { light, dark, custom } = get()
    localStorage.setItem(KEY, JSON.stringify({ light, dark, custom }))
  }
  return {
    ...load(),
    use: (id, mode) => {
      set(mode === 'light' ? { light: id } : mode === 'dark' ? { dark: id } : { light: id, dark: id })
      persist()
    },
    save: (theme) => {
      const next = { ...theme, custom: true }
      const custom = get().custom.some((t) => t.id === theme.id) ? get().custom.map((t) => (t.id === theme.id ? next : t)) : [...get().custom, next]
      set({ custom })
      persist()
    },
    remove: (id) => {
      const { light, dark } = get()
      set({ custom: get().custom.filter((t) => t.id !== id), light: light === id ? DEFAULT_THEME_ID : light, dark: dark === id ? DEFAULT_THEME_ID : dark })
      persist()
    },
  }
})

export const allThemes = (custom = useAppearance.getState().custom) => [...PRESET_THEMES, ...custom]
export const themeById = (id: string, custom = useAppearance.getState().custom) => allThemes(custom).find((t) => t.id === id) ?? PRESET_THEMES[0]

let applied: string[] = []

/** Puts the appearance and its theme's colors on <html>. */
function apply() {
  const root = document.documentElement
  const { theme } = useWorkspace.getState()
  const { light, dark } = useAppearance.getState()
  root.dataset.theme = theme
  for (const name of applied) root.style.removeProperty(name)
  const vars = themeVars(themeById(theme === 'dark' ? dark : light), theme)
  for (const [name, value] of Object.entries(vars)) root.style.setProperty(name, value)
  applied = Object.keys(vars)
  if (isTauri && isWindows) void paintWindowChrome()
}

/** "#rrggbb" for a CSS color, as the page draws it. */
function hexOf(color: string) {
  const probe = document.createElement('i')
  probe.style.color = color
  document.body.appendChild(probe)
  const rgb = getComputedStyle(probe).color.match(/\d+(\.\d+)?/g)?.map(Number) ?? [0, 0, 0]
  probe.remove()
  return `#${rgb
    .slice(0, 3)
    .map((v) => Math.round(v).toString(16).padStart(2, '0'))
    .join('')}`
}

/** Windows draws the title and menu bars itself; give them the tab bar's colors so the top of the window is one band. */
async function paintWindowChrome() {
  const { themeMode } = useWorkspace.getState()
  const { invoke } = await import('@tauri-apps/api/core')
  await invoke('set_window_chrome', {
    background: hexOf('var(--chrome)'),
    text: hexOf('var(--fg)'),
    hot: hexOf('var(--field-hover)'),
    disabled: hexOf('var(--fg-faint)'),
    theme: themeMode === 'system' ? null : themeMode,
  }).catch((err) => console.warn('Window colors', err))
}

/** Applies now, and again whenever the appearance or the theme changes. */
export function startAppearance() {
  apply()
  useWorkspace.subscribe((s, prev) => (s.theme !== prev.theme || s.themeMode !== prev.themeMode) && apply())
  useAppearance.subscribe(apply)
}

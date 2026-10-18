// Color themes. A theme is an accent plus two tones: one tints the light appearance and one the
// dark. The surfaces, borders and text of each appearance are worked out from its tone (a fixed
// ladder of lightnesses, so text stays readable whatever color the user picks), and the accent
// replaces the app's blue. The default theme sets nothing and keeps the colors in app.css.

export interface ThemeDef {
  id: string
  name: string
  /** #rrggbb. Buttons, selections and focus rings. */
  accent: string
  /** #rrggbb. Tints the light appearance's surfaces. */
  light: string
  /** #rrggbb. Tints the dark appearance's surfaces. */
  dark: string
  custom?: boolean
}

export const DEFAULT_THEME_ID = 'workspace'

export const PRESET_THEMES: ThemeDef[] = [
  { id: DEFAULT_THEME_ID, name: 'Workspace', accent: '#4f8cff', light: '#e6e6e6', dark: '#1c1c1c' },
  { id: 'iris', name: 'Iris', accent: '#7061ee', light: '#d8d3f6', dark: '#1d1b2e' },
  { id: 'rose', name: 'Rose', accent: '#d6477f', light: '#f4d9e4', dark: '#2a1621' },
  { id: 'grove', name: 'Grove', accent: '#3f9a6b', light: '#d8e7da', dark: '#16241b' },
  { id: 'ocean', name: 'Ocean', accent: '#3b82c4', light: '#d4e4ec', dark: '#13232d' },
  { id: 'ember', name: 'Ember', accent: '#d9733a', light: '#f0dccf', dark: '#26190f' },
]

export type Appearance = 'light' | 'dark'

const HEX = /^#[0-9a-f]{6}$/i
export const isHex = (value: unknown): value is string => typeof value === 'string' && HEX.test(value)

function rgb(hex: string): [number, number, number] {
  const n = parseInt(hex.slice(1), 16)
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255]
}

function toHsl(hex: string): [number, number, number] {
  const [r, g, b] = rgb(hex).map((v) => v / 255)
  const max = Math.max(r, g, b)
  const min = Math.min(r, g, b)
  const l = (max + min) / 2
  if (max === min) return [0, 0, l]
  const d = max - min
  const s = l > 0.5 ? d / (2 - max - min) : d / (max + min)
  const h = max === r ? (g - b) / d + (g < b ? 6 : 0) : max === g ? (b - r) / d + 2 : (r - g) / d + 4
  return [h * 60, s, l]
}

/** h in degrees, s and l from 0 to 1. */
function hsl(h: number, s: number, l: number) {
  const k = (n: number) => (n + h / 30) % 12
  const a = s * Math.min(l, 1 - l)
  const f = (n: number) => l - a * Math.max(-1, Math.min(k(n) - 3, 9 - k(n), 1))
  return `#${[f(0), f(8), f(4)].map((v) => Math.round(v * 255).toString(16).padStart(2, '0')).join('')}`
}

/** Black or white, whichever reads on `hex`. */
function textOn(hex: string) {
  const [r, g, b] = rgb(hex).map((v) => {
    const c = v / 255
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4
  })
  return 0.2126 * r + 0.7152 * g + 0.0722 * b > 0.45 ? '#111111' : '#ffffff'
}

/** The custom properties a theme sets for one appearance, over app.css's defaults. */
export function themeVars(theme: ThemeDef, mode: Appearance): Record<string, string> {
  const [h, s] = toHsl(mode === 'dark' ? theme.dark : theme.light)
  const [accentR, accentG, accentB] = rgb(theme.accent)
  const accent = {
    '--accent': theme.accent,
    '--accent-fg': textOn(theme.accent),
    '--accent-soft': `rgba(${accentR}, ${accentG}, ${accentB}, ${mode === 'dark' ? 0.18 : 0.14})`,
  }
  if (theme.id === DEFAULT_THEME_ID) return {}
  if (mode === 'dark') {
    const tint = Math.min(1, s) * 0.28
    const at = (l: number, extra = 0) => hsl(h, tint * (1 + extra), l / 100)
    return {
      ...accent,
      '--chrome': at(8.5),
      '--panel': at(10.5),
      '--canvas': at(6),
      '--raised': at(13.5),
      '--line': at(17.5),
      '--line-soft': at(13.5),
      '--field': at(14.5),
      '--field-hover': at(17.5),
      '--tab-active': at(14),
      '--fg': at(93, -0.6),
      '--fg-muted': at(66, -0.3),
      '--fg-faint': at(44),
    }
  }
  const tint = Math.min(1, s) * 0.4
  const at = (l: number, extra = 0) => hsl(h, tint * (1 + extra), l / 100)
  return {
    ...accent,
    '--chrome': at(92.5),
    '--panel': at(97),
    '--canvas': at(90),
    '--raised': at(100),
    '--line': at(85.5),
    '--line-soft': at(90),
    '--field': at(92.5),
    '--field-hover': at(89),
    '--tab-active': at(100),
    '--fg': at(12, -0.5),
    '--fg-muted': at(43, -0.3),
    '--fg-faint': at(66),
  }
}

/** The theme's accent alone, for the default theme (which has no `themeVars`) when it needs one. */
export function orbBackground(theme: ThemeDef, mode: Appearance) {
  const tone = mode === 'dark' ? theme.dark : theme.light
  const [h, s, l] = toHsl(tone)
  const high = hsl(h, Math.min(1, s) * (mode === 'dark' ? 0.5 : 0.35), mode === 'dark' ? Math.min(0.32, l + 0.14) : 0.98)
  return `radial-gradient(circle at 30% 24%, ${high} 0%, ${tone} 52%, ${theme.accent} 175%)`
}

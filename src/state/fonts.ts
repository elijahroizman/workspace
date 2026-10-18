// Fonts Workspace can add but not ship (src-tauri/src/fonts.rs). Michelangelus is Microsoft's
// free typeface drawn from Michelangelo's handwriting; its license forbids passing it on, so
// Settings downloads it from Microsoft when asked. Once it's there, Word documents (through the
// engine's customFonts) and slides (a page-wide FontFace) can use it.

import { create } from 'zustand'
import { isTauri } from '../lib/platform'

export interface ExtraFace {
  file: string
  weight: number
  style: 'normal' | 'italic'
  hash: string
}

export interface ExtraFont {
  id: string
  family: string
  maker: string
  about: string
  size: number
  licenseUrl: string
  faces: ExtraFace[]
}

export const EXTRA_FONTS: ExtraFont[] = [
  {
    id: 'michelangelus',
    family: 'Michelangelus',
    maker: 'Microsoft',
    about: 'A serif typeface drawn from Michelangelo’s handwriting. Free from Microsoft, which doesn’t allow apps to include it, so Workspace downloads it from Microsoft.',
    size: 410_000,
    licenseUrl: 'https://www.microsoft.com/en-us/download/details.aspx?id=108856',
    faces: [
      { file: 'Michelangelus-Regular.ttf', weight: 400, style: 'normal', hash: '8e21078b09f6befa90ece78b55b8140d4a3b778eb48e68a7c899e02074429a4a' },
      { file: 'Michelangelus-Italic.ttf', weight: 400, style: 'italic', hash: '36ef7b5a9a1f25c29c8ad3478d649fba2f64549bc50aab165dc55fb4418741da' },
      { file: 'Michelangelus-Bold.ttf', weight: 700, style: 'normal', hash: 'c5f07eb1d008b2ad1f75a9b5e8f91ba45827ef2b6d0f6989d0371a6168e1125f' },
      { file: 'Michelangelus-BoldItalic.ttf', weight: 700, style: 'italic', hash: 'f4815c2e4212be963d24c913c689dd2a97dc607e0e9ff0587f2ab90ad2641a52' },
    ],
  },
]

const invoke = async <T>(cmd: string, args?: Record<string, unknown>) => (await import('@tauri-apps/api/core')).invoke<T>(cmd, args)

// The Word engine caches font bytes by URL; these never leave the app (docx/extraFonts.ts answers them).
export const FONT_HOST = 'https://fonts.workspace.invalid/'
export const FONT_CACHE = 'workspace-extra-fonts'

interface FontsState {
  installed: Record<string, boolean>
  busy: Record<string, boolean>
  errors: Record<string, string>
  refresh(): Promise<void>
  install(id: string): Promise<void>
  remove(id: string): Promise<void>
}

export const useExtraFonts = create<FontsState>((set, get) => ({
  installed: {},
  busy: {},
  errors: {},

  refresh: async () => {
    if (!isTauri) return
    const ids = await invoke<string[]>('installed_fonts').catch(() => [])
    set({ installed: Object.fromEntries(ids.map((id) => [id, true])) })
    for (const id of ids) void registerPageFont(id)
  },

  install: async (id) => {
    if (get().busy[id]) return
    set({ busy: { ...get().busy, [id]: true }, errors: { ...get().errors, [id]: '' } })
    try {
      await invoke('install_font', { id })
      set({ installed: { ...get().installed, [id]: true } })
      await registerPageFont(id)
    } catch (err) {
      set({ errors: { ...get().errors, [id]: String(err) } })
    } finally {
      set({ busy: { ...get().busy, [id]: false } })
    }
  },

  remove: async (id) => {
    try {
      await invoke('remove_font', { id })
      set({ installed: { ...get().installed, [id]: false } })
      await globalThis.caches?.delete(FONT_CACHE).catch(() => false)
    } catch (err) {
      set({ errors: { ...get().errors, [id]: String(err) } })
    }
  },
}))

/** Families the slide editor's font menus should offer. */
export function extraFamilies(installed: Record<string, boolean>): string[] {
  return EXTRA_FONTS.filter((f) => installed[f.id]).map((f) => f.family)
}

export async function faceBytes(id: string, file: string): Promise<ArrayBuffer> {
  return invoke<ArrayBuffer>('font_file', { id, file })
}

const registered = new Set<string>()

/** Slides draw text with the page's own fonts, so the faces are added to document.fonts. */
async function registerPageFont(id: string) {
  const font = EXTRA_FONTS.find((f) => f.id === id)
  if (!font || registered.has(id)) return
  registered.add(id)
  await Promise.all(
    font.faces.map(async (face) => {
      try {
        const loaded = await new FontFace(font.family, await faceBytes(id, face.file), { weight: String(face.weight), style: face.style }).load()
        document.fonts.add(loaded)
      } catch (err) {
        console.warn(`Couldn't load ${face.file}`, err)
      }
    }),
  )
}

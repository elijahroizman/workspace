// Thin wrapper over the native shell. Inside the Tauri app everything goes to
// Rust; in a plain browser (`npm run dev` without Tauri) it falls back to file
// pickers and downloads so the UI can still be developed and tested.

import type { DocKind } from './kinds'
import { KINDS, kindFromPath } from './kinds'

export const isTauri = typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window
export const isMac = typeof navigator !== 'undefined' && /Mac/.test(navigator.platform || navigator.userAgent)
export const isWindows = typeof navigator !== 'undefined' && /Win/.test(navigator.platform || navigator.userAgent)

/** “Show in Finder” on a Mac, “Show in File Explorer” on Windows. */
export const revealLabel = isMac ? 'Show in Finder' : isWindows ? 'Show in File Explorer' : 'Show in Folder'

const KEY_NAMES: Record<string, string> = { '↩': 'Enter', '−': 'Minus', '+': 'Plus', '⌫': 'Backspace' }

/**
 * Shortcuts are written the Mac way in the source (“Duplicate (⇧⌘D)”). Everywhere else they
 * read Ctrl+Shift+D, the way Windows apps write them.
 */
export function shortcut(text: string): string {
  if (isMac) return text
  return text.replace(/([⌃⌥⇧⌘]+)([^\s)]+)|↩/g, (match, mods: string | undefined, key: string | undefined) => {
    if (!mods || !key) return KEY_NAMES[match] ?? match
    const parts: string[] = []
    if (/[⌘⌃]/.test(mods)) parts.push('Ctrl')
    if (mods.includes('⌥')) parts.push('Alt')
    if (mods.includes('⇧')) parts.push('Shift')
    parts.push(KEY_NAMES[key] ?? key)
    return parts.join('+')
  })
}

const core = () => import('@tauri-apps/api/core')
const dialog = () => import('@tauri-apps/plugin-dialog')

export interface OpenedFile {
  path: string
  name: string
  bytes: Uint8Array
}

// Browser fallback keeps picked files in memory under a fake path.
const browserFiles = new Map<string, Uint8Array>()

export function basename(path: string): string {
  return path.split(/[\\/]/).pop() || path
}

/** Shorten a path in your home folder to “~/…”. */
export function tildify(path: string): string {
  return path.replace(/^\/Users\/[^/]+/, '~').replace(/^\/home\/[^/]+/, '~').replace(/^[A-Z]:\\Users\\[^\\]+/i, '~')
}

export function dirname(path: string): string {
  const i = Math.max(path.lastIndexOf('/'), path.lastIndexOf('\\'))
  return i <= 0 ? path.slice(0, i + 1) : path.slice(0, i)
}

export function joinPath(dir: string, rel: string): string {
  const sep = dir.includes('\\') && !dir.includes('/') ? '\\' : '/'
  const parts = (dir + sep + rel).split(/[\\/]/)
  const out: string[] = []
  for (const part of parts) {
    if (part === '..') out.pop()
    else if (part !== '.' && (part !== '' || out.length === 0)) out.push(part)
  }
  return out.join(sep)
}

export async function readFile(path: string): Promise<Uint8Array> {
  if (!isTauri) {
    const bytes = browserFiles.get(path)
    if (bytes) return bytes
    const res = await fetch(path)
    if (!res.ok) throw new Error(`Couldn't open “${basename(path)}”`)
    return new Uint8Array(await res.arrayBuffer())
  }
  const { invoke } = await core()
  const data = await invoke<ArrayBuffer | number[]>('read_file', { path })
  return data instanceof ArrayBuffer ? new Uint8Array(data) : new Uint8Array(data)
}

export async function writeFile(path: string, bytes: Uint8Array): Promise<void> {
  if (!isTauri) {
    browserFiles.set(path, bytes)
    download(basename(path), bytes)
    return
  }
  const { invoke } = await core()
  await invoke('write_file', bytes, { headers: { 'x-path': encodeURIComponent(path) } })
}

/** Fetch a public https resource (used for video thumbnails). */
export async function fetchBytes(url: string): Promise<Uint8Array> {
  if (!isTauri) {
    const res = await fetch(url)
    if (!res.ok) throw new Error(`Couldn't download ${url}`)
    return new Uint8Array(await res.arrayBuffer())
  }
  const { invoke } = await core()
  const data = await invoke<ArrayBuffer | number[]>('fetch_bytes', { url })
  return data instanceof ArrayBuffer ? new Uint8Array(data) : new Uint8Array(data)
}

export async function pathExists(path: string): Promise<boolean> {
  if (!isTauri) return browserFiles.has(path)
  const { invoke } = await core()
  const info = await invoke<{ exists: boolean }>('path_info', { path })
  return info.exists
}

const ALL_EXTENSIONS = Object.values(KINDS).flatMap((k) => k.extensions)

export async function pickFiles(): Promise<OpenedFile[]> {
  if (!isTauri) return pickFilesInBrowser()
  const { open } = await dialog()
  const picked = await open({
    multiple: true,
    directory: false,
    filters: [
      { name: 'Documents', extensions: ALL_EXTENSIONS },
      ...Object.values(KINDS).map((k) => ({ name: k.label, extensions: k.extensions })),
    ],
  })
  if (!picked) return []
  const paths = Array.isArray(picked) ? picked : [picked]
  return Promise.all(paths.map(async (path) => ({ path, name: basename(path), bytes: await readFile(path) })))
}

function pickFilesInBrowser(): Promise<OpenedFile[]> {
  return new Promise((resolve) => {
    const input = document.createElement('input')
    input.type = 'file'
    input.multiple = true
    input.accept = ALL_EXTENSIONS.map((e) => '.' + e).join(',')
    input.onchange = async () => {
      const files = Array.from(input.files ?? [])
      resolve(await Promise.all(files.map(fileToOpened)))
    }
    input.oncancel = () => resolve([])
    input.click()
  })
}

const IMAGE_TYPES: Record<string, string> = {
  png: 'image/png',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  gif: 'image/gif',
  webp: 'image/webp',
  heic: 'image/heic',
  svg: 'image/svg+xml',
}

/** Ask for pictures. Resolves to none when cancelled. */
export async function pickImages({ multiple = false } = {}): Promise<File[]> {
  if (!isTauri) {
    return new Promise((resolve) => {
      const input = document.createElement('input')
      input.type = 'file'
      input.multiple = multiple
      input.accept = Object.values(IMAGE_TYPES).join(',')
      input.onchange = () => resolve(Array.from(input.files ?? []))
      input.oncancel = () => resolve([])
      input.click()
    })
  }
  const { open } = await dialog()
  const picked = await open({ multiple, directory: false, filters: [{ name: 'Images', extensions: Object.keys(IMAGE_TYPES) }] })
  if (!picked) return []
  const paths = Array.isArray(picked) ? picked : [picked]
  return Promise.all(
    paths.map(async (path) => {
      const name = basename(path)
      const type = IMAGE_TYPES[name.split('.').pop()!.toLowerCase()] ?? ''
      return new File([(await readFile(path)) as Uint8Array<ArrayBuffer>], name, { type })
    }),
  )
}

export async function fileToOpened(file: File): Promise<OpenedFile> {
  const bytes = new Uint8Array(await file.arrayBuffer())
  const path = `browser:/${crypto.randomUUID()}/${file.name}`
  browserFiles.set(path, bytes)
  return { path, name: file.name, bytes }
}

/** Ask where to save. Returns null when cancelled. */
export async function pickSavePath(suggestedName: string, kind: DocKind): Promise<string | null> {
  const ext = KINDS[kind].extensions[0]
  const name = suggestedName.toLowerCase().endsWith('.' + ext) ? suggestedName : `${suggestedName}.${ext}`
  if (!isTauri) return `browser:/${crypto.randomUUID()}/${name}`
  const { save } = await dialog()
  const path = await save({
    defaultPath: name,
    filters: [{ name: KINDS[kind].label, extensions: KINDS[kind].extensions }],
  })
  if (!path) return null
  // The macOS save panel can drop the extension if the user deletes it.
  return kindFromPath(path) ? path : `${path}.${ext}`
}

export async function confirmDialog(
  message: string,
  opts: { title?: string; okLabel?: string; cancelLabel?: string; kind?: 'warning' | 'info' } = {},
): Promise<boolean> {
  if (!isTauri) return window.confirm(message)
  const { ask } = await dialog()
  return ask(message, {
    title: opts.title ?? 'Workspace',
    kind: opts.kind ?? 'warning',
    okLabel: opts.okLabel,
    cancelLabel: opts.cancelLabel,
  })
}

export async function showError(message: string): Promise<void> {
  if (!isTauri) {
    window.alert(message)
    return
  }
  const { message: show } = await dialog()
  await show(message, { title: 'Workspace', kind: 'error' })
}

export async function openExternal(url: string): Promise<void> {
  if (!isTauri) {
    window.open(url, '_blank', 'noopener')
    return
  }
  const { openUrl } = await import('@tauri-apps/plugin-opener')
  await openUrl(url)
}

export async function revealInFinder(path: string): Promise<void> {
  if (!isTauri || path.startsWith('browser:')) return
  const { revealItemInDir } = await import('@tauri-apps/plugin-opener')
  await revealItemInDir(path)
}

export async function takePendingOpens(): Promise<string[]> {
  if (!isTauri) return []
  const { invoke } = await core()
  return invoke<string[]>('take_pending_opens')
}

export async function quitApp(): Promise<void> {
  if (!isTauri) return
  const { invoke } = await core()
  await invoke('quit_app')
}

type Unlisten = () => void

export async function listen<T>(event: string, handler: (payload: T) => void): Promise<Unlisten> {
  if (!isTauri) return () => {}
  const { listen } = await import('@tauri-apps/api/event')
  return listen<T>(event, (e) => handler(e.payload))
}

/** Files dragged from Finder onto the window. */
export async function onFileDrop(handler: (paths: string[]) => void, onHover?: (hovering: boolean) => void): Promise<Unlisten> {
  if (!isTauri) return () => {}
  const { getCurrentWebview } = await import('@tauri-apps/api/webview')
  return getCurrentWebview().onDragDropEvent((event) => {
    const p = event.payload
    if (p.type === 'over' || p.type === 'enter') onHover?.(true)
    else if (p.type === 'leave') onHover?.(false)
    else if (p.type === 'drop') {
      onHover?.(false)
      handler(p.paths)
    }
  })
}

/** Intercept the window close button so unsaved tabs can prompt. */
export async function onCloseRequested(shouldClose: () => Promise<boolean>): Promise<Unlisten> {
  if (!isTauri) return () => {}
  const { getCurrentWindow } = await import('@tauri-apps/api/window')
  const win = getCurrentWindow()
  return win.onCloseRequested(async (event) => {
    event.preventDefault()
    if (await shouldClose()) await win.destroy()
  })
}

/** The standard macOS “Do you want to save the changes…?” sheet. */
export async function askSaveChanges(name: string): Promise<'save' | 'discard' | 'cancel'> {
  const text = `Do you want to save the changes you made to “${name}”?`
  if (!isTauri) {
    if (window.confirm(`${text}\n\nOK saves, Cancel discards.`)) return 'save'
    return 'discard'
  }
  const { message } = await dialog()
  const result = await message(`${text}\n\nYour changes will be lost if you don’t save them.`, {
    title: 'Workspace',
    kind: 'warning',
    buttons: { yes: 'Save', no: 'Don’t Save', cancel: 'Cancel' },
  })
  if (result === 'Save' || result === 'Yes') return 'save'
  if (result === 'Don’t Save' || result === 'No') return 'discard'
  return 'cancel'
}

export async function setFullscreen(on: boolean): Promise<void> {
  if (!isTauri) {
    if (on) await document.documentElement.requestFullscreen?.().catch(() => {})
    else if (document.fullscreenElement) await document.exitFullscreen().catch(() => {})
    return
  }
  const { getCurrentWindow } = await import('@tauri-apps/api/window')
  await getCurrentWindow().setFullscreen(on)
}

export async function toggleFullscreen(): Promise<void> {
  if (!isTauri) return setFullscreen(!document.fullscreenElement)
  const { getCurrentWindow } = await import('@tauri-apps/api/window')
  const win = getCurrentWindow()
  await win.setFullscreen(!(await win.isFullscreen()))
}

export async function startWindowDrag(): Promise<void> {
  if (!isTauri) return
  const { getCurrentWindow } = await import('@tauri-apps/api/window')
  await getCurrentWindow().startDragging()
}

export async function toggleMaximize(): Promise<void> {
  if (!isTauri) return
  const { getCurrentWindow } = await import('@tauri-apps/api/window')
  await getCurrentWindow().toggleMaximize()
}

export function download(name: string, bytes: Uint8Array) {
  const url = URL.createObjectURL(new Blob([bytes as BlobPart]))
  const a = document.createElement('a')
  a.href = url
  a.download = name
  a.click()
  setTimeout(() => URL.revokeObjectURL(url), 10_000)
}

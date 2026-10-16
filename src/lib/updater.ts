// Keeps the app current. A check runs shortly after launch and every few hours, and again
// when the title-bar button is opened. A new version downloads in the background. Installing
// it on Windows hands off to the installer. On macOS the app quits and the same bundle is
// opened again, so the Dock icon stays put instead of a second copy appearing beside it.

import type { Update } from '@tauri-apps/plugin-updater'
import { create } from 'zustand'
import { isMac, isTauri } from './platform'

const FIRST_CHECK = 10_000
const CHECK_EVERY = 4 * 60 * 60_000
const RELEASE_URL = 'https://api.github.com/repos/elijahroizman/workspace/releases/latest'

export type UpdatePhase = 'idle' | 'checking' | 'downloading' | 'ready' | 'installing' | 'current' | 'error'

export interface ReleaseNotes {
  version: string
  name: string
  notes: string
  url: string
  publishedAt: string | null
}

interface UpdateSnapshot {
  phase: UpdatePhase
  open: boolean
  version: string | null
  notes: string
  url: string | null
  publishedAt: string | null
  error: string | null
}

export const useUpdate = create<UpdateSnapshot>(() => ({
  phase: 'idle',
  open: false,
  version: null,
  notes: '',
  url: null,
  publishedAt: null,
  error: null,
}))

let downloaded: Update | null = null
let checking = false

/** Release builds can download and install. Dev and the browser can still read the notes. */
export const updatesInstallable = isTauri && !import.meta.env.DEV

async function fetchRelease(): Promise<ReleaseNotes> {
  if (isTauri) {
    const { invoke } = await import('@tauri-apps/api/core')
    return invoke<ReleaseNotes>('latest_release')
  }
  const res = await fetch(RELEASE_URL, { headers: { Accept: 'application/vnd.github+json' } })
  if (!res.ok) throw new Error("Couldn't reach GitHub. Check your connection and try again.")
  const data = (await res.json()) as {
    tag_name?: string
    name?: string
    body?: string | null
    html_url?: string
    published_at?: string | null
  }
  const tag = data.tag_name ?? ''
  const version = /^v\d/.test(tag) ? tag.slice(1) : tag
  return {
    version,
    name: data.name?.trim() || `Workspace ${version}`,
    notes: data.body ?? '',
    url: data.html_url ?? RELEASE_URL,
    publishedAt: data.published_at ?? null,
  }
}

function remember(release: ReleaseNotes | null, update: Update | null) {
  return {
    version: update?.version || release?.version || null,
    notes: release?.notes || update?.body || '',
    url: release?.url ?? null,
    publishedAt: release?.publishedAt ?? null,
  }
}

/**
 * Look for a newer version and, in a release build, download it.
 * `force` drops a download already waiting so the check runs again.
 */
export async function checkForUpdates({ force = false }: { force?: boolean } = {}): Promise<void> {
  if (checking) return
  if (downloaded && !force) return
  checking = true
  if (force && downloaded) {
    const old = downloaded
    downloaded = null
    void old.close()
  }
  useUpdate.setState({ phase: 'checking', error: null })
  try {
    const releasePromise = fetchRelease().then(
      (release) => ({ release, error: null as string | null }),
      () => ({ release: null, error: "Couldn't reach GitHub. Check your connection and try again." }),
    )
    const updatePromise = (async () => {
      if (!updatesInstallable) return { update: null as Update | null, error: null as string | null }
      try {
        const { check } = await import('@tauri-apps/plugin-updater')
        return { update: await check(), error: null }
      } catch (err) {
        console.warn('Update check failed', err)
        return { update: null, error: "Couldn't check for an update." }
      }
    })()

    const [{ release, error: releaseError }, { update, error: updateError }] = await Promise.all([releasePromise, updatePromise])
    const info = remember(release, update)

    if (update) {
      useUpdate.setState({ phase: 'downloading', ...info, error: null })
      try {
        await update.download()
        downloaded = update
        useUpdate.setState({ phase: 'ready', ...info, error: null })
      } catch (err) {
        console.warn('Update download failed', err)
        void update.close()
        useUpdate.setState({ phase: 'error', ...info, error: "The update couldn't be downloaded." })
      }
      return
    }

    if (updateError && !release) {
      useUpdate.setState({ phase: 'error', ...info, error: updateError })
      return
    }
    useUpdate.setState({ phase: 'current', ...info, error: releaseError })
  } finally {
    checking = false
  }
}

export function openUpdatePanel(): void {
  useUpdate.setState({ open: true })
  const { phase } = useUpdate.getState()
  if (phase === 'idle' || phase === 'error' || phase === 'current') void checkForUpdates({ force: phase !== 'idle' })
}

export function toggleUpdatePanel(): void {
  if (useUpdate.getState().open) {
    useUpdate.setState({ open: false })
    return
  }
  openUpdatePanel()
}

export function closeUpdatePanel(): void {
  useUpdate.setState({ open: false })
}

export function startUpdateChecks(): () => void {
  if (!updatesInstallable) return () => {}
  const first = window.setTimeout(() => void checkForUpdates(), FIRST_CHECK)
  const timer = window.setInterval(() => void checkForUpdates(), CHECK_EVERY)
  return () => {
    window.clearTimeout(first)
    window.clearInterval(timer)
  }
}

/**
 * Install a downloaded update. With `restart`, the new version opens right away.
 * On Windows the installer takes over and this process exits. On macOS we quit
 * first and open the same bundle once this process is gone.
 */
export async function installUpdate({ restart }: { restart: boolean }): Promise<void> {
  if (!downloaded) return
  const update = downloaded
  useUpdate.setState({ phase: 'installing', error: null })
  let installed = false
  try {
    if (isMac) {
      // `restartAfterInstall` is a Windows installer flag. macOS only swaps the
      // bundle; relaunching here with the plugin would run `open -n`.
      await update.install()
      installed = true
      downloaded = null
      if (restart) {
        const { invoke } = await import('@tauri-apps/api/core')
        await invoke('relaunch_in_place')
      }
      return
    }
    await update.install({ restartAfterInstall: restart })
    installed = true
    downloaded = null
    if (restart) {
      const { relaunch } = await import('@tauri-apps/plugin-process')
      await relaunch()
    }
  } catch (err) {
    console.warn('Update install failed', err)
    downloaded = null
    if (!installed) void update.close()
    useUpdate.setState({
      phase: 'error',
      error: installed ? 'The update is installed. Quit and reopen Workspace to use it.' : "The update couldn't be installed.",
    })
  }
}

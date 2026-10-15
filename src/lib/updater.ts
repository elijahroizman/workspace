// Keeps the app current. Checks GitHub Releases shortly after launch and every few hours,
// downloads a new version in the background, then installs it when the app quits, or straight
// away if the user clicks “Restart to Update”.

import type { Update } from '@tauri-apps/plugin-updater'
import { create } from 'zustand'
import { isTauri } from './platform'

const FIRST_CHECK = 10_000
const CHECK_EVERY = 4 * 60 * 60_000

export const useUpdate = create<{ ready: string | null }>(() => ({ ready: null }))

let downloaded: Update | null = null
let checking = false

async function checkNow() {
  if (checking || downloaded) return
  checking = true
  try {
    const { check } = await import('@tauri-apps/plugin-updater')
    const update = await check()
    if (!update) return
    await update.download()
    downloaded = update
    useUpdate.setState({ ready: update.version })
  } catch (err) {
    // Offline, GitHub unreachable, or a bad signature: try again at the next check.
    console.warn('Update check failed', err)
  } finally {
    checking = false
  }
}

export function startUpdateChecks(): () => void {
  if (!isTauri || import.meta.env.DEV) return () => {}
  const first = window.setTimeout(() => void checkNow(), FIRST_CHECK)
  const timer = window.setInterval(() => void checkNow(), CHECK_EVERY)
  return () => {
    window.clearTimeout(first)
    window.clearInterval(timer)
  }
}

/**
 * Install a downloaded update. With `restart`, the new version opens right away; otherwise it
 * is in place for the next launch. On Windows the installer takes over and this process exits.
 */
export async function installUpdate({ restart }: { restart: boolean }): Promise<void> {
  if (!downloaded) return
  try {
    await downloaded.install({ restartAfterInstall: restart })
    downloaded = null
    if (restart) {
      const { relaunch } = await import('@tauri-apps/plugin-process')
      await relaunch()
    }
  } catch (err) {
    console.warn('Update install failed', err)
  }
}

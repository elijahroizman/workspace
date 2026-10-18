// The setup screen shows once, the first time Workspace runs after being installed. An update
// doesn't show it: a copy that has run before already has saved state.

import { create } from 'zustand'

const KEY = 'workspace.setupDone'

/** Anything an earlier version saves on every launch. */
const EARLIER_STATE = ['workspace.session', 'workspace.recents', 'workspace.theme', 'workspace.themeMode', 'workspace.settings', 'workspace.panels']

function firstRun(): boolean {
  try {
    const done = localStorage.getItem(KEY)
    // Quit halfway through setup last time: show it again.
    if (done === 'pending') return true
    if (done) return false
    if (EARLIER_STATE.some((key) => localStorage.getItem(key) !== null)) {
      // Updated from a version without setup: don't ask now.
      localStorage.setItem(KEY, '1')
      return false
    }
    localStorage.setItem(KEY, 'pending')
    return true
  } catch {
    return false
  }
}

interface SetupState {
  open: boolean
  /** Show it again (Settings › General). */
  show(): void
  finish(): void
}

export const useSetup = create<SetupState>((set) => ({
  open: firstRun(),
  show: () => set({ open: true }),
  finish: () => {
    localStorage.setItem(KEY, '1')
    set({ open: false })
  },
}))

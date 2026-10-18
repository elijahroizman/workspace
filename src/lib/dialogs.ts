// Questions and alerts drawn by the app itself (components/Dialogs.tsx) instead of the system's
// message boxes, so they look the same on macOS, Windows and Linux. One shows at a time; the
// rest wait their turn.

import { create } from 'zustand'

export interface DialogButton {
  label: string
  value: string
  /** Enter presses it. */
  primary?: boolean
  danger?: boolean
}

export interface DialogRequest {
  id: number
  kind: 'info' | 'warning' | 'error'
  title: string
  message?: string
  buttons: DialogButton[]
  /** What Escape or a click outside answers. */
  cancelValue: string
  resolve(value: string): void
}

export const useDialogs = create<{ queue: DialogRequest[] }>(() => ({ queue: [] }))

let nextId = 1

export function showDialog(request: Omit<DialogRequest, 'id' | 'resolve'>): Promise<string> {
  return new Promise((resolve) => {
    const entry: DialogRequest = { ...request, id: nextId++, resolve }
    useDialogs.setState((s) => ({ queue: [...s.queue, entry] }))
  })
}

export function answerDialog(id: number, value: string): void {
  const entry = useDialogs.getState().queue.find((d) => d.id === id)
  if (!entry) return
  useDialogs.setState((s) => ({ queue: s.queue.filter((d) => d.id !== id) }))
  entry.resolve(value)
}

export const dialogOpen = () => useDialogs.getState().queue.length > 0

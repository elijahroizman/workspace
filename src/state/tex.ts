// The system's TeX, for the LaTeX plugin: whether it's installed, compiling, and installing it
// (src-tauri/src/tex.rs). Workspace doesn't ship TeX; it offers to install MacTeX or MiKTeX when
// the plugin is turned on and there's none.

import { create } from 'zustand'
import type { TexResult, TexService, TexStatus } from '../plugins/api'
import { isMac, isTauri, isWindows } from '../lib/platform'

const invoke = async <T>(cmd: string, args?: Record<string, unknown>) => (await import('@tauri-apps/api/core')).invoke<T>(cmd, args)

export type InstallVariant = 'mactex' | 'basictex' | 'miktex'

export interface InstallProgress {
  stage: 'download' | 'verify' | 'install'
  received: number
  total: number
}

interface TexState {
  status: TexStatus | null
  /** The install offer is showing. */
  offer: boolean
  installing: InstallProgress | null
  error: string | null
  refresh(): Promise<TexStatus>
  /** Shows the install offer; resolves with the status once it closes. */
  offerInstall(): Promise<TexStatus>
  install(variant: InstallVariant): Promise<void>
  close(): void
}

const NONE: TexStatus = { installed: false, engines: [] }
let closed: ((status: TexStatus) => void)[] = []

export const useTex = create<TexState>((set, get) => ({
  status: null,
  offer: false,
  installing: null,
  error: null,

  refresh: async () => {
    const hook = texTestHook()
    const status = hook ? await hook.status() : isTauri ? await invoke<TexStatus>('tex_status').catch(() => NONE) : NONE
    set({ status })
    return status
  },

  offerInstall: () => {
    set({ offer: true, error: null })
    return new Promise((resolve) => closed.push(resolve))
  },

  install: async (variant) => {
    if (get().installing) return
    set({ installing: { stage: 'download', received: 0, total: 0 }, error: null })
    const { listen } = await import('@tauri-apps/api/event')
    const stop = await listen<InstallProgress>('tex-progress', ({ payload }) => set({ installing: payload }))
    try {
      const status = await invoke<TexStatus>('tex_install', { variant })
      set({ status })
      if (status.installed) get().close()
      else set({ error: 'TeX installed, but Workspace can’t find it. Restart Workspace and try again.' })
    } catch (err) {
      set({ error: String(err) })
    } finally {
      stop()
      set({ installing: null })
    }
  },

  close: () => {
    if (get().installing) return
    set({ offer: false })
    const status = get().status ?? NONE
    for (const resolve of closed) resolve(status)
    closed = []
  },
}))

/** What the install offer suggests on this system. */
export const INSTALL_CHOICES: { variant: InstallVariant; name: string; size: string; hint: string }[] = isMac
  ? [
      { variant: 'mactex', name: 'MacTeX', size: '6.9 GB', hint: 'All of TeX Live. Any document compiles.' },
      { variant: 'basictex', name: 'BasicTeX', size: '140 MB', hint: 'The common packages. Others need adding with tlmgr.' },
    ]
  : isWindows
    ? [{ variant: 'miktex', name: 'MiKTeX', size: '140 MB', hint: 'Installs packages as documents need them. Just for you, no administrator needed.' }]
    : []

/**
 * Test builds can stand in for the app's TeX (window.__texFake), so the plugin can be driven in
 * a browser.
 */
export function texTestHook(): Pick<TexService, 'status' | 'compile'> | undefined {
  if (!import.meta.env.DEV && !import.meta.env.VITE_TEST_HOOKS) return undefined
  return (window as { __texFake?: Pick<TexService, 'status' | 'compile'> }).__texFake
}

/** Compiles one at a time per tab; asking again while one runs replaces the waiting request. */
export function texService(tabId: string, folder: () => string | null, job: () => string): TexService {
  let running: Promise<unknown> = Promise.resolve()
  return {
    status: () => useTex.getState().refresh(),
    install: async () => {
      const status = await useTex.getState().refresh()
      return status.installed ? status : useTex.getState().offerInstall()
    },
    compile: (source, { engine }) => {
      const next = running.then(async (): Promise<TexResult> => {
        const hook = texTestHook()
        if (hook) return hook.compile(source, { engine })
        const reply = await invoke<ArrayBuffer>('tex_compile', { key: tabId, source, dir: folder(), engine, job: job() })
        const bytes = new Uint8Array(reply)
        const data = new DataView(reply)
        const pdfLength = data.getUint32(0, true)
        const fileLength = data.getUint32(4 + pdfLength, true)
        const text = new TextDecoder()
        return {
          pdf: pdfLength ? bytes.slice(4, 4 + pdfLength) : null,
          file: text.decode(bytes.subarray(8 + pdfLength, 8 + pdfLength + fileLength)),
          log: text.decode(bytes.subarray(8 + pdfLength + fileLength)),
        }
      })
      running = next.catch(() => {})
      return next
    },
  }
}

export const forgetTexBuild = (tabId: string) => void (isTauri && invoke('tex_forget', { key: tabId }).catch(() => {}))

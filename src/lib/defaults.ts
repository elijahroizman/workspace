// Making Workspace the app that opens each file type (src-tauri/src/defaults.rs). macOS sets it
// straight away; Windows only lets the user choose, so it opens Settings › Default apps.

import type { DocKind } from './kinds'
import { KINDS } from './kinds'
import { isMac, isTauri, isWindows } from './platform'

export const canSetDefaults = isTauri && (isMac || isWindows)

const invoke = async <T>(cmd: string, args?: Record<string, unknown>) => (await import('@tauri-apps/api/core')).invoke<T>(cmd, args)

/** For each kind: whether Workspace opens it now (null if the system can't say). */
export async function defaultStatus(kinds: DocKind[]): Promise<Record<DocKind, boolean | null>> {
  if (!canSetDefaults) return Object.fromEntries(kinds.map((k) => [k, null]))
  // A kind is Workspace's when every one of its extensions is.
  const exts = kinds.flatMap((k) => KINDS[k].extensions)
  const list = await invoke<{ ext: string; isDefault: boolean | null }[]>('default_apps', { exts })
  const byExt = new Map(list.map((s) => [s.ext, s.isDefault]))
  return Object.fromEntries(
    kinds.map((k) => {
      const each = KINDS[k].extensions.map((e) => byExt.get(e) ?? null)
      return [k, each.includes(null) ? null : each.every(Boolean)]
    }),
  )
}

/** Resolves true when Windows Settings opened for the user to finish there. */
export async function makeDefault(kinds: DocKind[]): Promise<boolean> {
  const exts = kinds.flatMap((k) => KINDS[k].extensions)
  const result = await invoke<{ openedSettings: boolean }>('set_default_apps', { exts })
  return result.openedSettings
}

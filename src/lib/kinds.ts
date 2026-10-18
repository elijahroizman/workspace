import type { KindInfo } from '../plugins/catalog'
import { PLUGINS } from '../plugins/catalog'

export type { KindInfo }

/** A document type, from a plugin (see plugins/catalog.ts): 'docx', 'pdf', 'excalidraw'… */
export type DocKind = string

/** Every kind any plugin opens, on or off. Whether a kind's plugin is on is in state/plugins.ts. */
export const KINDS: Record<DocKind, KindInfo> = Object.fromEntries(PLUGINS.flatMap((p) => p.kinds).map((k) => [k.id, k]))

export function kindFromPath(path: string): DocKind | null {
  const ext = path.split('.').pop()?.toLowerCase() ?? ''
  for (const info of Object.values(KINDS)) {
    if (info.extensions.includes(ext)) return info.id
  }
  return null
}

export function stripExtension(name: string): string {
  const kind = kindFromPath(name)
  if (!kind) return name
  return name.replace(/\.[^.]+$/, '')
}

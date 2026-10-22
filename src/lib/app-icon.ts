import type { AppIcon } from '../state/settings'
import { useSettings } from '../state/settings'
import { isTauri } from './platform'

/** Applies the saved icon at startup and whenever the choice changes. */
export function startAppIcon() {
  if (!isTauri) return
  // Keep quick successive choices in order, including while the native API loads.
  let pending = Promise.resolve()
  const apply = (variant: AppIcon) => {
    pending = pending.then(async () => {
      const { invoke } = await import('@tauri-apps/api/core')
      await invoke('set_app_icon', { variant })
    }).catch((err) => console.warn('App icon', err))
  }
  apply(useSettings.getState().appIcon)
  return useSettings.subscribe((s, prev) => {
    if (s.appIcon !== prev.appIcon) apply(s.appIcon)
  })
}

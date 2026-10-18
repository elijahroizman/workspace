import { useEffect, useRef, useState } from 'react'
import type { EditorProps } from '../App'
import { CenterState } from '../components/ui'
import { openExternal } from '../lib/platform'
import { pluginBaseUrl } from '../state/plugins'
import { useSettings } from '../state/settings'
import { registerEditor, useWorkspace } from '../state/workspace'
import type { PluginEditor as Instance, PluginModule } from './api'
import { PLUGIN_API_VERSION } from './api'
import { pluginForKind } from './catalog'

const modules = new Map<string, Promise<PluginModule>>()

/** A plugin's module, loaded once per launch. */
function loadModule(kind: string): Promise<PluginModule> {
  const plugin = pluginForKind(kind)
  let module = modules.get(plugin.id)
  if (!module) {
    module = import(/* @vite-ignore */ `${pluginBaseUrl(plugin)}index.js`).then((m: PluginModule) => {
      if (m.apiVersion !== PLUGIN_API_VERSION) throw new Error(`This version of the ${plugin.name} plugin doesn't fit this version of Workspace.`)
      return m
    })
    // A failed load (not downloaded yet, offline) can be tried again.
    module.catch(() => modules.delete(plugin.id))
    modules.set(plugin.id, module)
  }
  return module
}

/** Hosts an optional plugin's editor: the plugin renders into a plain element and talks through plugins/api.ts. */
export default function PluginEditor({ tab, active }: EditorProps) {
  const host = useRef<HTMLDivElement>(null)
  const instance = useRef<Instance | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [ready, setReady] = useState(false)
  const theme = useWorkspace((s) => s.theme)
  const plugin = pluginForKind(tab.kind)

  useEffect(() => {
    let cancelled = false
    let mounted: Instance | null = null
    void (async () => {
      try {
        const module = await loadModule(tab.kind)
        if (cancelled || !host.current) return
        mounted = await module.mount(host.current, {
          bytes: tab.bytes,
          title: tab.title,
          theme: useWorkspace.getState().theme,
          onChange: () => useWorkspace.getState().markDirty(tab.id, true),
          openExternal: (url) => void openExternal(url),
          print: async (content) => {
            const root = document.getElementById('print-root')!
            const page = document.createElement('div')
            page.className = 'print-page'
            page.appendChild(content)
            root.replaceChildren(page)
            window.print()
          },
        })
        if (cancelled) return mounted.destroy()
        instance.current = mounted
        setReady(true)
      } catch (err) {
        if (!cancelled) setError(err instanceof Error ? err.message : String(err))
      }
    })()
    return () => {
      cancelled = true
      mounted?.destroy()
      instance.current = null
    }
    // The tab remounts with a new loadId (see EditorSlot) when its bytes change.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  useEffect(() => {
    if (ready) instance.current?.setTheme?.(theme)
  }, [theme, ready])

  useEffect(() => {
    if (ready) instance.current?.setActive?.(active)
  }, [active, ready])

  useEffect(() => {
    if (!ready) return
    const it = instance.current!
    return registerEditor(tab.id, {
      getBytes: () => it.getBytes(),
      markSaved: it.markSaved && (() => it.markSaved!()),
      find: it.find && (() => it.find!()),
      zoom: it.zoom && ((direction) => it.zoom!(direction)),
      print: it.print && (() => it.print!()),
    })
  }, [tab.id, ready])

  if (error) {
    return (
      <CenterState title={`Couldn’t start ${plugin.name}`}>
        <p className="muted">{error}</p>
        <button type="button" className="btn" onClick={() => useSettings.getState().setOpen(true, 'plugins')}>
          Open Plugins settings
        </button>
      </CenterState>
    )
  }
  return (
    <div className="plugin-editor">
      {/* The plugin owns this element and everything in it. */}
      <div className="plugin-editor-host" ref={host} />
      {!ready && (
        <div className="plugin-editor-loading">
          <CenterState spinner />
        </div>
      )}
    </div>
  )
}

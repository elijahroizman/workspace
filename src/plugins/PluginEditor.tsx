import { useEffect, useRef, useState } from 'react'
import type { EditorProps } from '../App'
import { CenterState } from '../components/ui'
import { FindBar, Workbench } from '../components/Workbench'
import { KINDS } from '../lib/kinds'
import { openExternal } from '../lib/platform'
import { installSettled, pluginBaseUrl } from '../state/plugins'
import { useSettings } from '../state/settings'
import { registerEditor, useWorkspace } from '../state/workspace'
import type { PluginEditor as Instance, PluginModule, SearchResult } from './api'
import { PLUGIN_API_VERSION } from './api'
import { pluginForKind } from './catalog'

const modules = new Map<string, Promise<PluginModule>>()

/** A plugin's module, loaded once per launch. */
function loadModule(kind: string): Promise<PluginModule> {
  const plugin = pluginForKind(kind)
  let module = modules.get(plugin.id)
  if (!module) {
    // An update downloading at launch replaces the files; load the new ones once it's done.
    module = installSettled(plugin.id)
      .then(() => import(/* @vite-ignore */ `${pluginBaseUrl(plugin)}index.js`))
      .then((m: PluginModule) => {
      if (m.apiVersion !== PLUGIN_API_VERSION) throw new Error(`This version of the ${plugin.name} plugin doesn't fit this version of Workspace.`)
      return m
    })
    // A failed load (not downloaded yet, offline) can be tried again.
    module.catch(() => modules.delete(plugin.id))
    modules.set(plugin.id, module)
  }
  return module
}

/** Puts the plugin's sidebar element into Workspace's sidebar while that is open. */
function SidebarSlot({ element }: { element: HTMLElement }) {
  const slot = useRef<HTMLDivElement>(null)
  useEffect(() => {
    slot.current!.appendChild(element)
    return () => element.remove()
  }, [element])
  return <div ref={slot} />
}

/** Hosts an optional plugin's editor: the plugin renders into a plain element and talks through plugins/api.ts. */
export default function PluginEditor({ tab, active }: EditorProps) {
  const host = useRef<HTMLDivElement>(null)
  const instance = useRef<Instance | null>(null)
  /** `start`: the plugin didn't load. `open`: it did, but couldn't open this file. */
  const [error, setError] = useState<{ stage: 'start' | 'open'; message: string } | null>(null)
  const [ready, setReady] = useState(false)
  const [findOpen, setFindOpen] = useState(false)
  const [found, setFound] = useState<SearchResult | null>(null)
  const findQuery = useRef('')
  const theme = useWorkspace((s) => s.theme)
  const plugin = pluginForKind(tab.kind)
  // Kinds with a sidebar get an element in it that outlives the sidebar being hidden.
  const [sidebar] = useState(() => (KINDS[tab.kind].panels.left ? document.createElement('div') : null))

  useEffect(() => {
    let cancelled = false
    let mounted: Instance | null = null
    void (async () => {
      let stage: 'start' | 'open' = 'start'
      try {
        const module = await loadModule(tab.kind)
        if (cancelled || !host.current) return
        stage = 'open'
        mounted = await module.mount(host.current, {
          bytes: tab.bytes,
          title: tab.title,
          theme: useWorkspace.getState().theme,
          onChange: () => useWorkspace.getState().markDirty(tab.id, true),
          openExternal: (url) => void openExternal(url),
          sidebar: sidebar ?? undefined,
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
        if (!cancelled) setError({ stage, message: err instanceof Error ? err.message : String(err) })
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
      find: it.search ? () => setFindOpen(true) : it.find && (() => it.find!()),
      zoom: it.zoom && ((direction) => it.zoom!(direction)),
      print: it.print && (() => it.print!()),
    })
  }, [tab.id, ready])

  const search = (step: 1 | -1 | 0) => {
    const it = instance.current
    if (it?.search) setFound(it.search(findQuery.current, step))
  }

  if (error?.stage === 'open') {
    return (
      <CenterState title={`Couldn’t open “${tab.title}”`}>
        <p className="muted">{error.message}</p>
      </CenterState>
    )
  }
  if (error) {
    return (
      <CenterState title={`Couldn’t start ${plugin.name}`}>
        <p className="muted">{error.message}</p>
        <button type="button" className="btn" onClick={() => useSettings.getState().setOpen(true, 'plugins')}>
          Open Plugins settings
        </button>
      </CenterState>
    )
  }
  const editor = (
    <div className="plugin-editor">
      {/* The plugin owns this element and everything in it. */}
      <div className="plugin-editor-host" ref={host} />
      {!ready && (
        <div className="plugin-editor-loading">
          <CenterState spinner />
        </div>
      )}
      <FindBar
        open={findOpen}
        onClose={() => {
          setFindOpen(false)
          // The bar keeps the query for next time; the highlights go.
          instance.current?.search?.('', 0)
          setFound(null)
        }}
        onQuery={(query) => {
          findQuery.current = query
          search(0)
        }}
        onNext={() => search(1)}
        onPrev={() => search(-1)}
        count={found?.count ?? null}
        current={found ? Math.max(0, found.current) : null}
      />
    </div>
  )
  if (!sidebar) return editor
  return (
    <Workbench tab={tab} left={<SidebarSlot element={sidebar} />}>
      {editor}
    </Workbench>
  )
}

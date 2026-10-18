import { Excalidraw, MainMenu, exportToBlob, getSceneVersion, loadFromBlob, serializeAsJSON } from '@excalidraw/excalidraw'
import '@excalidraw/excalidraw/index.css'
import type { ExcalidrawImperativeAPI, ExcalidrawInitialDataState } from '@excalidraw/excalidraw/types'
import { StrictMode, useState } from 'react'
import { createRoot } from 'react-dom/client'
import type { PluginEditor, PluginEditorContext, Theme } from '../../src/plugins/api'

const ZOOM_STEP = 1.2
const MIN_ZOOM = 0.1
const MAX_ZOOM = 30

/** What changes a drawing: its elements, and pictures added to it. */
function sceneKey(api: ExcalidrawImperativeAPI) {
  return `${getSceneVersion(api.getSceneElementsIncludingDeleted())}:${Object.keys(api.getFiles()).length}:${api.getAppState().viewBackgroundColor}`
}

export async function mountEditor(element: HTMLElement, context: PluginEditorContext): Promise<PluginEditor> {
  let initialData: ExcalidrawInitialDataState | null = null
  if (context.bytes?.length) {
    const scene = await loadFromBlob(new Blob([context.bytes as Uint8Array<ArrayBuffer>], { type: 'application/json' }), null, null)
    initialData = { elements: scene.elements, appState: scene.appState, files: scene.files, scrollToContent: true }
  }

  let api: ExcalidrawImperativeAPI | null = null
  let ready: () => void
  const apiReady = new Promise<void>((resolve) => (ready = resolve))
  let savedKey: string | null = null
  let reportedKey: string | null = null
  let setTheme: (theme: Theme) => void = () => {}

  function App() {
    const [theme, setThemeState] = useState<Theme>(context.theme)
    setTheme = setThemeState
    return (
      <Excalidraw
        theme={theme}
        initialData={initialData}
        excalidrawAPI={(instance) => {
          api = instance
          ready()
        }}
        UIOptions={{
          // Workspace opens and saves files; Excalidraw keeps image export.
          canvasActions: { loadScene: false, saveToActiveFile: false, export: false, toggleTheme: null },
        }}
        onChange={() => {
          if (!api) return
          const key = sceneKey(api)
          // The first change is Excalidraw settling the loaded scene. After that it also calls
          // this for scrolling and selection; only a different drawing is an edit.
          if (savedKey === null) savedKey = reportedKey = key
          else if (key !== reportedKey) {
            reportedKey = key
            if (key !== savedKey) context.onChange()
          }
        }}
        onLinkOpen={(el, event) => {
          const link = el.link
          if (link && /^(https?:|mailto:)/i.test(link)) {
            event.preventDefault()
            context.openExternal(link)
          }
        }}
      >
        <MainMenu>
          <MainMenu.DefaultItems.SaveAsImage />
          <MainMenu.DefaultItems.SearchMenu />
          <MainMenu.DefaultItems.Help />
          <MainMenu.DefaultItems.ClearCanvas />
          <MainMenu.Separator />
          <MainMenu.DefaultItems.ChangeCanvasBackground />
        </MainMenu>
      </Excalidraw>
    )
  }

  const root = createRoot(element)
  root.render(
    <StrictMode>
      <App />
    </StrictMode>,
  )
  await apiReady
  const excalidraw = () => api!

  return {
    async getBytes() {
      const a = excalidraw()
      return new TextEncoder().encode(serializeAsJSON(a.getSceneElements(), a.getAppState(), a.getFiles(), 'local'))
    },
    markSaved() {
      savedKey = sceneKey(excalidraw())
    },
    setTheme: (theme) => setTheme(theme),
    find() {
      excalidraw().toggleSidebar({ name: 'default', tab: 'search', force: true })
    },
    zoom(direction) {
      const a = excalidraw()
      if (direction === 'reset') {
        a.scrollToContent(undefined, { fitToContent: true, animate: true })
        return
      }
      const state = a.getAppState()
      const from = state.zoom.value
      const to = Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, direction === 'in' ? from * ZOOM_STEP : from / ZOOM_STEP))
      // Keep the middle of the view where it is.
      const cx = state.width / 2
      const cy = state.height / 2
      a.updateScene({
        appState: {
          zoom: { value: to as typeof state.zoom.value },
          scrollX: state.scrollX + cx / to - cx / from,
          scrollY: state.scrollY + cy / to - cy / from,
        },
      })
    },
    async print() {
      const a = excalidraw()
      const blob = await exportToBlob({
        elements: a.getSceneElements(),
        appState: { ...a.getAppState(), exportBackground: true, exportWithDarkMode: false },
        files: a.getFiles(),
        mimeType: 'image/png',
        exportPadding: 24,
        getDimensions: (w: number, h: number) => ({ width: w * 2, height: h * 2, scale: 2 }),
      })
      const img = new Image()
      img.src = URL.createObjectURL(blob)
      await img.decode()
      await context.print(img)
      URL.revokeObjectURL(img.src)
    },
    destroy() {
      root.unmount()
    },
  }
}

// The contract between Workspace and an optional plugin's editor. A plugin's index.js is an ES
// module exporting `apiVersion` and `mount`. It brings its own UI framework and renders into
// the element it is given, so the app and its plugins don't have to share React versions.
// Keep this file free of imports: plugins compile against it too.

/** Bump when the contract changes in a way old plugins can't follow. */
export const PLUGIN_API_VERSION = 1

export type Theme = 'light' | 'dark'

export interface PluginEditorContext {
  /** The file's bytes; null for a new, empty document. */
  bytes: Uint8Array | null
  /** The tab's title. */
  title: string
  theme: Theme
  /** Call after every change the user makes; Workspace marks the tab unsaved and autosaves. */
  onChange(): void
  /** Open a link in the default browser. */
  openExternal(url: string): void
  /** Print this content (an image or a page of HTML) with the system print dialog. */
  print(content: Node): Promise<void>
  /**
   * An element in Workspace's left sidebar to render into (a table of contents, say). Only for
   * kinds whose catalog entry has `panels.left`; Workspace shows and hides it with ⌘\.
   */
  sidebar?: HTMLElement
  /** For editors with search(): the matches changed without a new query (more content loaded). */
  searchChanged?(result: SearchResult): void
}

export interface SearchResult {
  count: number
  /** Index of the selected match; -1 for none. */
  current: number
}

export interface PluginEditor {
  /** The document as it should be saved. */
  getBytes(): Promise<Uint8Array>
  /** The file was just saved. */
  markSaved?(): void
  setTheme?(theme: Theme): void
  /** The tab was shown (true) or hidden (false). */
  setActive?(active: boolean): void
  find?(): void
  /**
   * Instead of find(): Workspace shows its own find bar and asks for matches. `step` moves the
   * selection to the next (1) or previous (-1) match; 0 is a new query. An empty query clears.
   */
  search?(query: string, step: 1 | -1 | 0): SearchResult
  zoom?(direction: 'in' | 'out' | 'reset'): void
  print?(): Promise<void>
  /** The tab closed: release everything. */
  destroy(): void
}

export interface PluginModule {
  apiVersion: number
  mount(element: HTMLElement, context: PluginEditorContext): PluginEditor | Promise<PluginEditor>
}

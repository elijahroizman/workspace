// A starting point for a plugin: a text format edited as source with a live preview, using the
// shared source-and-preview kit (plugins/shared). Copy it with `npm run plugin:new` and replace
// the preview with whatever your format renders to. See plugins/README.md for the whole API.
//
// The format here is plain text whose preview shows each paragraph. Files end in `.template`.

import type { PluginEditor, PluginModule } from '../../src/plugins/api'
import { encode, mountSourcePreview, sidebarHint, sidebarItem, sidebarSection } from '../shared/source-preview'

export const apiVersion: PluginModule['apiVersion'] = 1

const ZOOMS = [0.75, 0.9, 1, 1.25, 1.5, 2]

export const mount: PluginModule['mount'] = (element, context): PluginEditor => {
  // The preview's own look; Workspace's variables (--fg, --line…) work because plugins render
  // in its page. Add styles once per page, not once per tab.
  if (!document.querySelector('style[data-workspace-plugin="template"]')) {
    const style = document.createElement('style')
    style.dataset.workspacePlugin = 'template'
    style.textContent = '.template-preview { overflow: auto; padding: 32px 40px; line-height: 1.6; color: var(--fg); }'
    document.head.appendChild(style)
  }

  const page = document.createElement('div')
  page.className = 'template-preview'
  let zoom = 2 // index into ZOOMS

  // The kit owns CodeMirror, the layout and the typing pause; onIdle renders the preview.
  const kit = mountSourcePreview({
    element,
    context,
    blank: 'A new document.\n\nWrite on the left; the preview follows.\n',
    placeholder: 'Start writing…',
    // context.previewDelay is the user's setting for slow previews (a compile). A cheap preview
    // like this one renders sooner.
    delay: () => 200,
    onIdle(text) {
      const paragraphs = text.split(/\n{2,}/).filter((p) => p.trim())
      page.replaceChildren(
        ...paragraphs.map((p) => {
          const node = document.createElement('p')
          node.textContent = p // textContent: never put file contents into innerHTML
          return node
        }),
      )
      words.replaceChildren(sidebarHint(`${text.split(/\s+/).filter(Boolean).length} words, ${paragraphs.length} paragraphs`))
    },
  })
  kit.preview.appendChild(page)

  // The sidebar exists when the catalog entry's kind has `panels.left: true`. Build sections
  // once and update their contents; Workspace keeps the element while the sidebar is hidden.
  const words = document.createElement('div')
  if (context.sidebar) {
    sidebarSection(context.sidebar, 'Document').appendChild(words)
    sidebarSection(context.sidebar, 'Export').appendChild(
      sidebarItem('Save as text…', {
        onClick: () => void context.saveFile?.({ bytes: encode(kit.text()), name: `${context.title}.txt` }),
      }),
    )
  }

  return {
    // What Save writes. Workspace calls it; the plugin never writes files itself.
    getBytes: async () => encode(kit.text()),
    // With `views`, Workspace shows its read / split / write switch (⌘E cycles) and calls setView.
    views: { read: 'Preview', split: 'Source and preview', write: 'Source' },
    setView: (view) => kit.setView(view),
    find: () => kit.find(),
    zoom(direction) {
      zoom = direction === 'reset' ? 2 : Math.max(0, Math.min(ZOOMS.length - 1, zoom + (direction === 'in' ? 1 : -1)))
      page.style.fontSize = `${ZOOMS[zoom]}em`
    },
    // The theme is also on <html data-theme>, so CSS alone often covers it; this is for canvases
    // and libraries that take a theme option.
    setTheme() {},
    // A hidden tab can pause timers or animations here.
    setActive() {},
    print: () => context.print(page.cloneNode(true)),
    destroy() {
      kit.destroy()
      context.sidebar?.replaceChildren()
    },
  }
}

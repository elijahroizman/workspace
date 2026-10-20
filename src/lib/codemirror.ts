import { openSearchPanel } from '@codemirror/search'
import type { EditorView } from '@codemirror/view'

/** Open CodeMirror's search panel at its replace field (at the find field while that's empty). */
export function focusReplace(view: EditorView) {
  openSearchPanel(view)
  const panel = view.dom.querySelector('.cm-search')
  const find = panel?.querySelector<HTMLInputElement>('input[name=search]')
  const replace = panel?.querySelector<HTMLInputElement>('input[name=replace]')
  const field = find?.value ? replace : find
  field?.focus()
  field?.select()
}

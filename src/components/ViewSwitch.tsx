// The read / split / write switch that Markdown and the source-and-preview plugins (Mermaid,
// LaTeX) share, with the view-* shortcuts (⌘E cycles).

import { BookOpen, Columns2, SquarePen } from 'lucide-react'
import type { ViewMode } from '../plugins/api'
import { withKeys } from '../state/shortcuts'
import { Segmented } from './ui'

export type { ViewMode }

const ORDER: ViewMode[] = ['read', 'split', 'write']

export const DEFAULT_VIEW_LABELS: Record<ViewMode, string> = { read: 'Read', split: 'Edit with preview', write: 'Edit source' }

/** The view a view-* command asks for, from the current one. */
export function nextView(current: ViewMode, command: ViewMode | 'cycle'): ViewMode {
  return command === 'cycle' ? ORDER[(ORDER.indexOf(current) + 1) % ORDER.length] : command
}

/** A document opens to read; a new one opens with its source showing. */
export const initialView = (hasBytes: boolean): ViewMode => (hasBytes ? 'read' : 'split')

export function ViewSwitch({ mode, setMode, labels = DEFAULT_VIEW_LABELS }: { mode: ViewMode; setMode: (mode: ViewMode) => void; labels?: Record<ViewMode, string> }) {
  return (
    <Segmented
      value={mode}
      onChange={setMode}
      options={[
        { value: 'read', icon: <BookOpen size={14} />, title: withKeys(labels.read, 'view-read') },
        { value: 'split', icon: <Columns2 size={14} />, title: withKeys(labels.split, 'view-split') },
        { value: 'write', icon: <SquarePen size={14} />, title: withKeys(labels.write, 'view-write') },
      ]}
    />
  )
}

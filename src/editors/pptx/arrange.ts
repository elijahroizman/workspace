import type { Element } from './types'
import { hasText } from './types'

export type Restack = 'front' | 'forward' | 'backward' | 'back'

/** Selected frames, including the contents of selected groups. */
function picked(elements: readonly Element[], ids: ReadonlySet<string>, inside = false): Element[] {
  return elements.flatMap((el) => {
    const selected = inside || ids.has(el.id)
    return el.type === 'group' ? picked(el.children ?? [], ids, selected) : selected ? [el] : []
  })
}
export const pickedText = (elements: readonly Element[], ids: ReadonlySet<string>) => picked(elements, ids).filter(hasText)
export const pickedShapes = (elements: readonly Element[], ids: ReadonlySet<string>) => picked(elements, ids).filter((el) => el.type === 'text' || el.type === 'shape' || el.type === 'connector')

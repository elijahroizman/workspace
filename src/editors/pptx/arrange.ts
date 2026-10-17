import { applyTextStyleUpdate } from 'ooxml-ui/pptx'
import type { Element, ShapeStyle, Slide, TextStyle } from './types'
import { hasText } from './types'

export type Restack = 'front' | 'forward' | 'backward' | 'back'

/** Move the picked objects in the stacking order, keeping their order among themselves. */
export function restack(elements: readonly Element[], ids: ReadonlySet<string>, how: Restack): Element[] {
  const picked = elements.filter((e) => ids.has(e.id))
  const rest = elements.filter((e) => !ids.has(e.id))
  if (how === 'front') return [...rest, ...picked]
  if (how === 'back') return [...picked, ...rest]
  const out = [...elements]
  // One step: each picked object swaps with the unpicked neighbour above (or below) it.
  if (how === 'forward') {
    for (let i = out.length - 2; i >= 0; i--) if (ids.has(out[i].id) && !ids.has(out[i + 1].id)) [out[i], out[i + 1]] = [out[i + 1], out[i]]
  } else {
    for (let i = 1; i < out.length; i++) if (ids.has(out[i].id) && !ids.has(out[i - 1].id)) [out[i], out[i - 1]] = [out[i - 1], out[i]]
  }
  return out
}

/** Whether a restack would change anything, for enabling its button. */
export function canRestack(elements: readonly Element[], ids: ReadonlySet<string>, how: Restack) {
  const next = restack(elements, ids, how)
  return next.some((e, i) => e !== elements[i])
}

/** Apply a change to the picked objects, and to everything inside picked groups. */
export function mapPicked(elements: readonly Element[], ids: ReadonlySet<string>, change: (el: Element) => Element, inside = false): Element[] {
  return elements.map((el) => {
    const picked = inside || ids.has(el.id)
    const children = (el as { children?: Element[] }).children
    if (el.type === 'group' && children) return { ...el, children: mapPicked(children, ids, change, picked) } as Element
    return picked ? change(el) : el
  })
}

/** Restyle all of an object's text, as the inspector does for a single text box. */
export function styleText(el: Element, updates: Partial<TextStyle>): Element {
  if (!hasText(el)) return el
  const { patch } = applyTextStyleUpdate(el, updates, null, (el as { textSegments?: Parameters<typeof applyTextStyleUpdate>[3] }).textSegments)
  return { ...el, ...patch } as Element
}

export function styleShape(el: Element, updates: Partial<ShapeStyle>): Element {
  if (el.type !== 'shape' && el.type !== 'text' && el.type !== 'connector') return el
  const shape = (el as { shapeStyle?: ShapeStyle }).shapeStyle
  return { ...el, shapeStyle: { ...shape, ...updates } } as Element
}

/** Every object in the selection that can hold text, including inside groups. */
export function pickedText(elements: readonly Element[], ids: ReadonlySet<string>, inside = false): (Element & { textStyle?: TextStyle })[] {
  return elements.flatMap((el) => {
    const picked = inside || ids.has(el.id)
    const children = (el as { children?: Element[] }).children
    if (el.type === 'group' && children) return pickedText(children, ids, picked)
    return picked && hasText(el) ? [el] : []
  })
}

/** Replace one slide's objects, for `editSlides`. */
export function withElements(index: number, update: (elements: readonly Element[]) => Element[]) {
  return (slides: readonly Slide[]) => slides.map((s, i) => (i === index ? { ...s, elements: update(s.elements) } : s))
}

/** Every selected object with a fill and line, including inside groups. */
export function pickedShapes(elements: readonly Element[], ids: ReadonlySet<string>, inside = false): Element[] {
  return elements.flatMap((el) => {
    const picked = inside || ids.has(el.id)
    const children = (el as { children?: Element[] }).children
    if (el.type === 'group' && children) return pickedShapes(children, ids, picked)
    return picked && (el.type === 'shape' || el.type === 'text' || el.type === 'connector') ? [el] : []
  })
}

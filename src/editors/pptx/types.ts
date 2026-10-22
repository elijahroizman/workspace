import type { Element, SlideInfo, SlidesEngine, Transition } from '../../engine/slides/engine'

export type { Element, SlideInfo, Transition }

/** Everything the sidebar and inspector need from the engine, read fresh every render. */
export interface Deck {
  engine: SlidesEngine
  slides: readonly SlideInfo[]
  activeIndex: number
  /** The active slide's frames. */
  elements: readonly Element[]
  /** Slides picked in the sidebar (indexes, in order); always includes the active one. */
  selectedSlides: number[]
  /** Frames picked on the slide. */
  selectedIds: string[]
  /** The one picked frame, if exactly one is. */
  selectedElement: Element | null
}

export const hasText = (el: Element | null | undefined): el is Element => !!el && (el.type === 'text' || el.type === 'shape')

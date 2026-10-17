import type { PowerPointViewerHandle, SlideCanvasProps, ToolbarProps } from 'pptx-react-viewer'

/** The engine's handle, plus `editSlides`, which vite.config.ts adds: one undoable edit of the slide list. */
export type Handle = PowerPointViewerHandle & { editSlides: (update: (slides: readonly Slide[]) => Slide[]) => void }
export type Toolbar = ToolbarProps
export type Canvas = SlideCanvasProps
export type Slide = NonNullable<SlideCanvasProps['activeSlide']>
export type Element = NonNullable<ToolbarProps['selectedElement']>
export type TextStyle = Parameters<ToolbarProps['onUpdateTextStyle']>[0]
export type ShapeStyle = Parameters<ToolbarProps['onUpdateElementStyle']>[0]
export type ShapeKind = Parameters<ToolbarProps['onSetNewShapeType']>[0]
export type Transition = NonNullable<Slide['transition']>

/** Everything the sidebar and inspector need from the engine, read fresh every render. */
export interface Deck {
  handle: React.RefObject<Handle | null>
  tb: Toolbar
  cv: Canvas
  slides: readonly Slide[]
  activeIndex: number
  templateFor: (slide: Slide) => Element[]
  /** Latest toolbar props, for callbacks that run after a re-render. */
  tbRef: React.RefObject<Toolbar>
  /** Slides picked in the sidebar (indexes, in order); always includes the active one. */
  selectedSlides: number[]
  /** Objects picked on the slide. */
  selectedIds: string[]
}

export const hasText = (el: Element | null | undefined): el is Element & { textStyle?: TextStyle; text?: string } =>
  !!el && (el.type === 'text' || el.type === 'shape' || el.type === 'connector')

export const shapeStyleOf = (el: Element | null | undefined): ShapeStyle | undefined =>
  el && 'shapeStyle' in el ? (el as { shapeStyle?: ShapeStyle }).shapeStyle : undefined

export const linkOf = (el: Element | null | undefined): string | null => el?.actionClick?.url ?? null

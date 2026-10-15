import type { PowerPointViewerHandle, SlideCanvasProps, ToolbarProps } from 'pptx-react-viewer'

export type Handle = PowerPointViewerHandle
export type Toolbar = ToolbarProps
export type Canvas = SlideCanvasProps
export type Slide = NonNullable<SlideCanvasProps['activeSlide']>
export type Element = NonNullable<ToolbarProps['selectedElement']>
export type TextStyle = Parameters<ToolbarProps['onUpdateTextStyle']>[0]
export type ShapeStyle = Parameters<ToolbarProps['onUpdateElementStyle']>[0]
export type ShapeKind = Parameters<ToolbarProps['onSetNewShapeType']>[0]

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
}

export const hasText = (el: Element | null | undefined): el is Element & { textStyle?: TextStyle; text?: string } =>
  !!el && (el.type === 'text' || el.type === 'shape' || el.type === 'connector')

export const shapeStyleOf = (el: Element | null | undefined): ShapeStyle | undefined =>
  el && 'shapeStyle' in el ? (el as { shapeStyle?: ShapeStyle }).shapeStyle : undefined

export const linkOf = (el: Element | null | undefined): string | null => el?.actionClick?.url ?? null

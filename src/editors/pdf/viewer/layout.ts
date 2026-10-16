import type { PageInfo } from '../engine/protocol'

/** CSS pixels per PDF point at 100% (pages show at their real size on a 96 dpi screen). */
export const CSS_UNITS = 96 / 72
export const MIN_ZOOM = 0.1
export const MAX_ZOOM = 8
/** Fit-to-window zoom never goes above this for portrait pages, like Preview and Firefox. */
const MAX_AUTO_ZOOM = 1.25

const PAD_TOP = 24
const GAP = 16
const SIDE = 24
/** Room for the floating zoom bar under the last page. */
const PAD_BOTTOM = 112

export type ZoomMode = 'auto' | 'page-width' | 'page-fit'

export interface Layout {
  zoom: number
  /** CSS pixels per point. */
  unit: number
  tops: Float64Array
  widths: Float64Array
  heights: Float64Array
  width: number
  height: number
}

export function computeLayout(pages: PageInfo[], zoom: number, viewportWidth: number): Layout {
  const unit = zoom * CSS_UNITS
  const n = pages.length
  const tops = new Float64Array(n)
  const widths = new Float64Array(n)
  const heights = new Float64Array(n)
  let y = PAD_TOP
  let maxW = 0
  for (let i = 0; i < n; i++) {
    widths[i] = pages[i].width * unit
    heights[i] = pages[i].height * unit
    // Whole pixels, so page drawings (and the tiles of a zoomed-in page) line up with the screen.
    tops[i] = Math.round(y)
    y = tops[i] + heights[i] + GAP
    if (widths[i] > maxW) maxW = widths[i]
  }
  return { zoom, unit, tops, widths, heights, width: Math.max(viewportWidth, maxW + SIDE * 2), height: y - GAP + PAD_BOTTOM }
}

export const pageLeft = (layout: Layout, i: number) => Math.round((layout.width - layout.widths[i]) / 2)

/** Index of the last page whose top is at or above `y`. */
export function pageAt(layout: Layout, y: number) {
  const { tops } = layout
  let lo = 0
  let hi = tops.length - 1
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1
    if (tops[mid] <= y) lo = mid
    else hi = mid - 1
  }
  return lo
}

/** Pages overlapping [top, bottom]. */
export function pagesIn(layout: Layout, top: number, bottom: number): [number, number] {
  if (!layout.tops.length) return [0, -1]
  return [pageAt(layout, top), pageAt(layout, bottom)]
}

/** The page taking up most of the window (what "Page 3 of 10" refers to). */
export function mostVisible(layout: Layout, top: number, bottom: number) {
  const [first, last] = pagesIn(layout, top, bottom)
  let best = first
  let bestArea = -1
  for (let i = first; i <= last; i++) {
    const visible = Math.min(bottom, layout.tops[i] + layout.heights[i]) - Math.max(top, layout.tops[i])
    if (visible > bestArea + 1) {
      best = i
      bestArea = visible
    }
  }
  return best
}

export function fitZoom(mode: ZoomMode, page: PageInfo | undefined, viewport: { width: number; height: number }) {
  if (!page) return 1
  const widthZoom = (viewport.width - SIDE * 2) / (page.width * CSS_UNITS)
  const heightZoom = (viewport.height - PAD_TOP - GAP) / (page.height * CSS_UNITS)
  let zoom: number
  if (mode === 'page-width') zoom = widthZoom
  else if (mode === 'page-fit') zoom = Math.min(widthZoom, heightZoom)
  else zoom = page.width > page.height ? Math.min(widthZoom, heightZoom) : Math.min(MAX_AUTO_ZOOM, widthZoom)
  return clampZoom(zoom)
}

export const clampZoom = (z: number) => Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, z))

const STEPS = [0.1, 0.25, 0.33, 0.5, 0.67, 0.75, 0.8, 0.9, 1, 1.1, 1.25, 1.5, 1.75, 2, 2.5, 3, 4, 5, 6.4, 8]

/** The next preset zoom level in or out from `zoom`. */
export function stepZoom(zoom: number, dir: 1 | -1) {
  if (dir > 0) return STEPS.find((s) => s > zoom + 0.001) ?? MAX_ZOOM
  return [...STEPS].reverse().find((s) => s < zoom - 0.001) ?? MIN_ZOOM
}

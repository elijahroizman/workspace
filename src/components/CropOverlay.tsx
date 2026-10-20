import { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { Button } from './ui'

/** A box on screen, in client pixels. */
export interface Rect {
  x: number
  y: number
  width: number
  height: number
}

type Edge = 'nw' | 'n' | 'ne' | 'e' | 'se' | 's' | 'sw' | 'w'
const EDGES: Edge[] = ['nw', 'n', 'ne', 'e', 'se', 's', 'sw', 'w']

/** The smallest crop, in screen pixels. */
const MIN = 12

export const rectOf = (r: DOMRect | Rect): Rect => ({ x: r.x, y: r.y, width: r.width, height: r.height })

/**
 * Crop a picture on screen, the same way in documents and presentations. `frame` is the part of
 * the picture that shows, `image` the whole picture (larger when it is already cropped). Drag an
 * edge or corner to crop, or the picture to move it inside the frame. Enter, Done or a click
 * elsewhere keeps the crop; Escape or Cancel drops it. Scrolling or zooming keeps it too, since
 * the picture would move out from under the overlay.
 */
export function CropOverlay({
  src,
  frame: startFrame,
  image: startImage,
  onDone,
  onCancel,
}: {
  src: string
  frame: Rect
  image: Rect
  onDone: (frame: Rect, image: Rect) => void
  onCancel: () => void
}) {
  const [frame, setFrame] = useState(startFrame)
  const [image, setImage] = useState(startImage)
  const latest = useRef({ frame, image })
  latest.current = { frame, image }
  const root = useRef<HTMLDivElement>(null)
  const ended = useRef(false)
  const end = useRef<(keep: boolean) => void>(() => {})
  end.current = (keep) => {
    if (ended.current) return
    ended.current = true
    if (keep) onDone(latest.current.frame, latest.current.image)
    else onCancel()
  }

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Enter' && e.key !== 'Escape') return
      e.preventDefault()
      e.stopImmediatePropagation()
      end.current(e.key === 'Enter')
    }
    const onPress = (e: PointerEvent) => {
      if (!root.current?.contains(e.target as Node)) end.current(true)
    }
    const onMove = (e: Event) => {
      if (!root.current?.contains(e.target as Node)) end.current(true)
    }
    window.addEventListener('keydown', onKey, true)
    window.addEventListener('pointerdown', onPress, true)
    window.addEventListener('scroll', onMove, true)
    window.addEventListener('wheel', onMove, true)
    window.addEventListener('resize', onMove)
    return () => {
      window.removeEventListener('keydown', onKey, true)
      window.removeEventListener('pointerdown', onPress, true)
      window.removeEventListener('scroll', onMove, true)
      window.removeEventListener('wheel', onMove, true)
      window.removeEventListener('resize', onMove)
    }
  }, [])

  const drag = (e: React.PointerEvent, what: Edge | 'move') => {
    if (e.button !== 0) return
    e.preventDefault()
    e.stopPropagation()
    const target = e.currentTarget as HTMLElement
    target.setPointerCapture(e.pointerId)
    const { frame: f, image: i } = latest.current
    const move = (ev: PointerEvent) => {
      const dx = ev.clientX - e.clientX
      const dy = ev.clientY - e.clientY
      if (what === 'move') setImage(moveImage(f, i, dx, dy))
      else setFrame(moveEdges(f, i, what, dx, dy))
    }
    const up = () => {
      target.removeEventListener('pointermove', move)
      target.removeEventListener('pointerup', up)
      target.removeEventListener('pointercancel', up)
    }
    target.addEventListener('pointermove', move)
    target.addEventListener('pointerup', up)
    target.addEventListener('pointercancel', up)
  }

  const box = (r: Rect) => ({ left: r.x, top: r.y, width: r.width, height: r.height })
  // The buttons sit under the frame, or above it when the frame reaches the bottom of the window.
  const below = frame.y + frame.height + 52 < window.innerHeight

  return createPortal(
    <div ref={root} className="crop-overlay">
      <div className="crop-image" style={box(image)} onPointerDown={(e) => drag(e, 'move')}>
        <img src={src} alt="" draggable={false} />
        <div className="crop-window" style={box({ ...frame, x: frame.x - image.x, y: frame.y - image.y })} />
      </div>
      <div className="crop-frame" style={box(frame)} onPointerDown={(e) => drag(e, 'move')}>
        {EDGES.map((edge) => (
          <span key={edge} className={`crop-handle ${edge}`} onPointerDown={(e) => drag(e, edge)} />
        ))}
      </div>
      <div
        className="crop-bar"
        style={{ left: frame.x + frame.width / 2, top: below ? frame.y + frame.height + 12 : Math.max(8, frame.y - 46) }}
        onPointerDown={(e) => e.stopPropagation()}
      >
        <Button disabled={sameRect(frame, image)} onClick={() => setFrame(image)}>
          Reset
        </Button>
        <Button onClick={() => end.current(false)}>Cancel</Button>
        <Button variant="primary" onClick={() => end.current(true)}>
          Done
        </Button>
      </div>
    </div>,
    document.body,
  )
}

const clamp = (v: number, lo: number, hi: number) => Math.min(Math.max(v, lo), hi)

const sameRect = (a: Rect, b: Rect) => Math.abs(a.x - b.x) < 0.5 && Math.abs(a.y - b.y) < 0.5 && Math.abs(a.width - b.width) < 0.5 && Math.abs(a.height - b.height) < 0.5

/** Drag frame edges, staying on the picture and no smaller than MIN. */
function moveEdges(f: Rect, i: Rect, edge: Edge, dx: number, dy: number): Rect {
  let [left, top, right, bottom] = [f.x, f.y, f.x + f.width, f.y + f.height]
  // A picture padded inside its frame (negative crop) lets the frame stay where it is.
  const [minX, minY, maxX, maxY] = [Math.min(i.x, left), Math.min(i.y, top), Math.max(i.x + i.width, right), Math.max(i.y + i.height, bottom)]
  if (edge.includes('w')) left = clamp(left + dx, minX, right - MIN)
  if (edge.includes('e')) right = clamp(right + dx, left + MIN, maxX)
  if (edge.includes('n')) top = clamp(top + dy, minY, bottom - MIN)
  if (edge.includes('s')) bottom = clamp(bottom + dy, top + MIN, maxY)
  return { x: left, y: top, width: right - left, height: bottom - top }
}

/** Move the picture behind the frame, keeping the frame covered. */
function moveImage(f: Rect, i: Rect, dx: number, dy: number): Rect {
  const range = (start: number, size: number, picture: number) => [Math.min(start, start + size - picture), Math.max(start, start + size - picture)] as const
  const [x0, x1] = range(f.x, f.width, i.width)
  const [y0, y1] = range(f.y, f.height, i.height)
  return { ...i, x: clamp(i.x + dx, x0, x1), y: clamp(i.y + dy, y0, y1) }
}

import { SlideLayer } from 'pptx-react-viewer/internals'
import { memo, useEffect, useRef, useState } from 'react'
import type { Canvas, Element, Slide } from './types'

/** A slide drawn by the engine at full size and scaled down; mounted only when on screen. */
export const SlidePreview = memo(function SlidePreview({
  slide,
  templateElements,
  canvasSize,
  width,
  lazy = true,
}: {
  slide: Slide
  templateElements: Element[]
  canvasSize: Canvas['canvasSize']
  width: number
  lazy?: boolean
}) {
  const ref = useRef<HTMLDivElement>(null)
  const [visible, setVisible] = useState(!lazy)
  useEffect(() => {
    if (!lazy) return
    const observer = new IntersectionObserver(([entry]) => setVisible(entry.isIntersecting), { rootMargin: '600px 0px' })
    observer.observe(ref.current!)
    return () => observer.disconnect()
  }, [lazy])
  const scale = width / canvasSize.width
  return (
    <div ref={ref} className="slide-preview" style={{ width, height: canvasSize.height * scale }}>
      {visible && (
        <div style={{ width: canvasSize.width, height: canvasSize.height, transform: `scale(${scale})`, transformOrigin: '0 0', pointerEvents: 'none' }}>
          <SlideLayer slide={slide} templateElements={templateElements} canvasSize={canvasSize} />
        </div>
      )}
    </div>
  )
})

/** Left sidebar: every slide, click to go, drag to reorder, right-click for more. */
export function SlideStrip({
  slides,
  activeIndex,
  canvasSize,
  templateFor,
  onSelect,
  onMove,
  onMenu,
}: {
  slides: readonly Slide[]
  activeIndex: number
  canvasSize: Canvas['canvasSize']
  templateFor: (slide: Slide) => Element[]
  onSelect: (index: number) => void
  onMove: (from: number, to: number) => void
  onMenu: (index: number, x: number, y: number) => void
}) {
  const listRef = useRef<HTMLDivElement>(null)
  const [drag, setDrag] = useState<{ from: number; target: number } | null>(null)
  const [thumbWidth, setThumbWidth] = useState(196)

  // Thumbnails fill the sidebar, which the user can resize.
  useEffect(() => {
    const list = listRef.current!
    const observer = new ResizeObserver(() => setThumbWidth(Math.max(80, Math.floor(list.clientWidth - 40))))
    observer.observe(list)
    return () => observer.disconnect()
  }, [])

  useEffect(() => {
    listRef.current?.querySelector(`[data-index="${activeIndex}"]`)?.scrollIntoView({ block: 'nearest' })
  }, [activeIndex])

  const startDrag = (e: React.PointerEvent, index: number) => {
    if (e.button !== 0) return
    const startY = e.clientY
    const el = e.currentTarget as HTMLElement
    let dragging = false
    let target = index
    const move = (ev: PointerEvent) => {
      if (!dragging && Math.abs(ev.clientY - startY) < 6) return
      if (!dragging) el.setPointerCapture(e.pointerId)
      dragging = true
      const items = Array.from(listRef.current!.querySelectorAll<HTMLElement>('.slide-item'))
      target = items.length
      for (let i = 0; i < items.length; i++) {
        const r = items[i].getBoundingClientRect()
        if (ev.clientY < r.top + r.height / 2) {
          target = i
          break
        }
      }
      setDrag({ from: index, target })
      const scroller = listRef.current!.closest('.sidebar-scroll')
      if (scroller) {
        const r = scroller.getBoundingClientRect()
        if (ev.clientY < r.top + 30) scroller.scrollTop -= 12
        else if (ev.clientY > r.bottom - 30) scroller.scrollTop += 12
      }
    }
    const up = () => {
      el.removeEventListener('pointermove', move)
      el.removeEventListener('pointerup', up)
      el.removeEventListener('pointercancel', up)
      setDrag(null)
      if (!dragging) {
        onSelect(index)
        return
      }
      const to = target > index ? target - 1 : target
      if (to !== index) onMove(index, to)
    }
    el.addEventListener('pointermove', move)
    el.addEventListener('pointerup', up)
    el.addEventListener('pointercancel', up)
  }

  return (
    <div className="slide-list" ref={listRef} role="listbox" aria-label="Slides">
      {slides.map((slide, i) => (
        <div
          key={slide.id}
          data-index={i}
          role="option"
          aria-selected={i === activeIndex}
          className={`slide-item ${i === activeIndex ? 'active' : ''} ${slide.hidden ? 'hidden-slide' : ''} ${drag?.target === i ? 'drop-before' : ''} ${
            drag && drag.target === slides.length && i === slides.length - 1 ? 'drop-after' : ''
          } ${drag?.from === i ? 'dragging' : ''}`}
          onPointerDown={(e) => startDrag(e, i)}
          onContextMenu={(e) => {
            e.preventDefault()
            onSelect(i)
            onMenu(i, e.clientX, e.clientY)
          }}
        >
          <span className="slide-number">{i + 1}</span>
          <div className="slide-thumb">
            <SlidePreview slide={slide} templateElements={templateFor(slide)} canvasSize={canvasSize} width={thumbWidth} />
          </div>
        </div>
      ))}
    </div>
  )
}

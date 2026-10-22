import { X } from 'lucide-react'
import { resolveTransitionDurationMs } from './transitions'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import * as platform from '../../lib/platform'
import { SlideImage } from '../../engine/slides/SlideImage'
import { SlideSwap } from './SlideSwap'
import type { Element, SlideInfo, SlidesEngine } from '../../engine/slides/engine'
import { parseVideoLink } from './video'

const resolveDuration = (slide: SlideInfo | undefined) => resolveTransitionDurationMs(slide?.transition)

/**
 * Full-screen slideshow. Arrow keys, space or a click advance; esc ends. Clicking an object
 * with a link opens it, and video links play right on the slide. Moving forward plays the
 * next slide's transition, and a slide set to advance after a time does so.
 */
export function PresentMode({
  engine,
  startIndex,
  onExit,
}: {
  engine: SlidesEngine
  startIndex: number
  onExit: (lastIndex: number) => void
}) {
  // Hidden slides are skipped, but we report positions in the full deck.
  const order = useMemo(() => engine.slides.map((s, i) => ({ s, i })).filter(({ s }) => !s.hidden), [engine, engine.slides])
  const [pos, setPos] = useState(() => Math.max(0, order.findIndex(({ i }) => i >= startIndex)))
  // The slide being left, while the next one's transition plays over it.
  const [swap, setSwap] = useState<{ from: number; run: number }>({ from: -1, run: 0 })
  const [video, setVideo] = useState<{ embed: string; rect: { left: number; top: number; width: number; height: number } } | null>(null)
  const [box, setBox] = useState({ width: window.innerWidth, height: window.innerHeight })
  const stageRef = useRef<HTMLDivElement>(null)
  const exitRef = useRef(onExit)
  exitRef.current = onExit

  const current = order[pos]
  const finish = useCallback(() => exitRef.current(order[pos]?.i ?? startIndex), [order, pos, startIndex])
  const go = useCallback(
    (delta: number) => {
      setVideo(null)
      const next = Math.min(order.length - 1, Math.max(0, pos + delta))
      if (next === pos) return
      setSwap((s) => ({ from: delta > 0 ? pos : -1, run: s.run + 1 }))
      setPos(next)
    },
    [order.length, pos],
  )

  // Advance on its own after the slide's timing, as PowerPoint does.
  const advanceAfter = current?.s.transition?.afterMs
  useEffect(() => {
    if (advanceAfter == null || video || pos >= order.length - 1) return
    const timer = window.setTimeout(() => go(1), advanceAfter + resolveDuration(current?.s))
    return () => window.clearTimeout(timer)
  }, [advanceAfter, video, pos, order.length, go, current])

  useEffect(() => {
    void platform.setFullscreen(true)
    return () => {
      void platform.setFullscreen(false)
    }
  }, [])

  // Measure the stage itself. Full screen changes its box after
  // window.innerHeight, and a stale size scales the slide past the screen.
  useEffect(() => {
    const el = stageRef.current
    if (!el) return
    const measure = () => {
      const rect = el.getBoundingClientRect()
      if (rect.width > 0 && rect.height > 0) setBox({ width: rect.width, height: rect.height })
    }
    measure()
    const observer = new ResizeObserver(measure)
    observer.observe(el)
    return () => observer.disconnect()
  }, [])

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (['ArrowRight', 'ArrowDown', ' ', 'PageDown', 'Enter', 'n'].includes(e.key)) go(1)
      else if (['ArrowLeft', 'ArrowUp', 'PageUp', 'Backspace', 'p'].includes(e.key)) go(-1)
      else if (e.key === 'Home') setPos(0)
      else if (e.key === 'End') setPos(order.length - 1)
      else if (e.key === 'Escape') (video ? setVideo(null) : finish())
      else return
      e.preventDefault()
      e.stopImmediatePropagation()
    }
    // Capture phase so the editor underneath never sees these keys.
    window.addEventListener('keydown', onKey, true)
    return () => window.removeEventListener('keydown', onKey, true)
  }, [go, finish, order.length, video])

  const scale = Math.min(box.width / engine.width, box.height / engine.height)
  const width = engine.width * scale
  const height = engine.height * scale
  const left = (box.width - width) / 2
  const top = (box.height - height) / 2

  const onClick = (e: React.MouseEvent) => {
    if (!current) return
    // Hit-test linked objects, topmost first.
    const stage = stageRef.current!.getBoundingClientRect()
    const x = (e.clientX - stage.left - left) / scale
    const y = (e.clientY - stage.top - top) / scale
    const elements = JSON.parse(engine.doc.elements(current.i)) as Element[]
    const hit = linkedAt(elements, x, y)
    const url = hit?.link?.url
    if (hit && url) {
      const videoLink = parseVideoLink(url)
      if (videoLink && videoLink.provider !== 'other') {
        setVideo({ embed: videoLink.embedUrl, rect: { left: left + hit.x * scale, top: top + hit.y * scale, width: hit.width * scale, height: hit.height * scale } })
      } else {
        void platform.openExternal(url)
      }
      return
    }
    if (video) setVideo(null)
    else if (current.s.transition?.onClick === false) return
    else if (pos >= order.length - 1) finish()
    else go(1)
  }

  return (
    <div className="present" onClick={onClick} ref={stageRef}>
      {current && (
        <div style={{ position: 'absolute', left, top, width, height }}>
          <SlideSwap
            run={swap.run}
            transition={current.s.transition}
            outgoing={order[swap.from] && <SlideImage engine={engine} index={order[swap.from].i} revision={order[swap.from].s.revision} width={width} lazy={false} />}
            incoming={<SlideImage key={current.s.id} engine={engine} index={current.i} revision={current.s.revision} width={width} lazy={false} />}
          />
        </div>
      )}
      {video && (
        <div className="present-video" style={video.rect} onClick={(e) => e.stopPropagation()}>
          <iframe
            src={video.embed}
            title="Video"
            allow="autoplay; encrypted-media; picture-in-picture; fullscreen"
            allowFullScreen
            referrerPolicy="strict-origin-when-cross-origin"
          />
          <button type="button" className="present-video-close" aria-label="Close video" onClick={() => setVideo(null)}>
            <X size={16} />
          </button>
        </div>
      )}
      <div className="present-hud">
        {pos + 1} / {order.length} · Esc to exit
      </div>
    </div>
  )
}

/** Linked frames are hit in paint order, using their rotated bounds. */
function linkedAt(elements: readonly Element[], x: number, y: number): Element | undefined {
  for (const el of [...elements].reverse()) {
    const child = el.children && linkedAt(el.children, x, y)
    if (child) return child
    if (!el.link?.url) continue
    const angle = -el.rotation * Math.PI / 180
    const dx = x - el.x - el.width / 2
    const dy = y - el.y - el.height / 2
    const lx = dx * Math.cos(angle) - dy * Math.sin(angle)
    const ly = dx * Math.sin(angle) + dy * Math.cos(angle)
    if (Math.abs(lx) <= el.width / 2 && Math.abs(ly) <= el.height / 2) return el
  }
}

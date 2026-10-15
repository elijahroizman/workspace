import { X } from 'lucide-react'
import { useCallback, useEffect, useRef, useState } from 'react'
import * as platform from '../../lib/platform'
import { SlidePreview } from './SlideStrip'
import type { Canvas, Element, Slide } from './types'
import { linkOf } from './types'
import { parseVideoLink } from './video'

/**
 * Full-screen slideshow. Arrow keys, space or a click advance; esc ends. Clicking an object
 * with a link opens it, and video links play right on the slide.
 */
export function PresentMode({
  slides: allSlides,
  startIndex,
  canvasSize,
  templateFor,
  onExit,
}: {
  slides: readonly Slide[]
  startIndex: number
  canvasSize: Canvas['canvasSize']
  templateFor: (slide: Slide) => Element[]
  onExit: (lastIndex: number) => void
}) {
  // Hidden slides are skipped, but we report positions in the full deck.
  const order = allSlides.map((s, i) => ({ s, i })).filter(({ s }) => !s.hidden)
  const [pos, setPos] = useState(() => Math.max(0, order.findIndex(({ i }) => i >= startIndex)))
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
      setPos((p) => Math.min(order.length - 1, Math.max(0, p + delta)))
    },
    [order.length],
  )

  useEffect(() => {
    void platform.setFullscreen(true)
    const onResize = () => setBox({ width: window.innerWidth, height: window.innerHeight })
    window.addEventListener('resize', onResize)
    return () => {
      window.removeEventListener('resize', onResize)
      void platform.setFullscreen(false)
    }
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

  const scale = Math.min(box.width / canvasSize.width, box.height / canvasSize.height)
  const width = canvasSize.width * scale
  const height = canvasSize.height * scale
  const left = (box.width - width) / 2
  const top = (box.height - height) / 2

  const onClick = (e: React.MouseEvent) => {
    if (!current) return
    // Hit-test linked objects, topmost first.
    const x = (e.clientX - left) / scale
    const y = (e.clientY - top) / scale
    const hit = [...current.s.elements].reverse().find((el) => linkOf(el) && x >= el.x && x <= el.x + el.width && y >= el.y && y <= el.y + el.height)
    const url = hit && linkOf(hit)
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
    else if (pos >= order.length - 1) finish()
    else go(1)
  }

  return (
    <div className="present" onClick={onClick} ref={stageRef}>
      {current && (
        <div style={{ position: 'absolute', left, top }}>
          <SlidePreview key={current.s.id} slide={current.s} templateElements={templateFor(current.s)} canvasSize={canvasSize} width={width} lazy={false} />
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
        {pos + 1} / {order.length} · esc to exit
      </div>
    </div>
  )
}

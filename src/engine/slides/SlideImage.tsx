// One slide, drawn from the engine's display list at slide size and scaled to `width`: the
// thumbnails, the slideshow, transition previews and printing all use it. Lazy ones are drawn
// only when near the screen.

import { memo, useEffect, useRef, useState } from 'react'
import type { SlidesEngine } from './engine'
import './slides.css'

export const SlideImage = memo(function SlideImage({ engine, index, revision, width, lazy = true }: { engine: SlidesEngine; index: number; revision: number; width: number; lazy?: boolean }) {
  const ref = useRef<HTMLDivElement>(null)
  const [visible, setVisible] = useState(!lazy)
  useEffect(() => {
    if (!lazy) return
    const observer = new IntersectionObserver(([entry]) => setVisible(entry.isIntersecting), { rootMargin: '600px 0px' })
    observer.observe(ref.current!)
    return () => observer.disconnect()
  }, [lazy])
  const scale = width / engine.width
  return (
    <div ref={ref} className="slide-preview" style={{ width, height: engine.height * scale }}>
      {visible && (
        <div
          className="slide-surface"
          style={{ width: engine.width, height: engine.height, transform: `scale(${scale})` }}
          // Drawn per revision, so this changes only when the slide does.
          dangerouslySetInnerHTML={{ __html: engine.html(index) }}
          data-revision={revision}
        />
      )}
    </div>
  )
})

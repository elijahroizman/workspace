import { SLIDE_TRANSITION_KEYFRAMES, resolveSlideTransition, resolveTransitionDurationMs } from 'ooxml-ui/pptx'
import type { ReactNode } from 'react'
import { useEffect, useState } from 'react'
import type { Transition } from './types'

let keyframesAdded = false
function addKeyframes() {
  if (keyframesAdded) return
  keyframesAdded = true
  const style = document.createElement('style')
  style.dataset.source = 'pptx-transitions'
  style.textContent = SLIDE_TRANSITION_KEYFRAMES
  document.head.appendChild(style)
}

/**
 * Two slides stacked in one box, with the incoming one's transition played between them
 * (the engine's own keyframes). A new `run` plays it again; without `outgoing` it just shows `incoming`.
 */
export function SlideSwap({ outgoing, incoming, transition, run }: { outgoing: ReactNode | null; incoming: ReactNode; transition: Transition | undefined; run: number }) {
  // The run whose transition has finished; a new run plays until its duration is up.
  const [ended, setEnded] = useState(run)
  const duration = resolveTransitionDurationMs(transition)
  const active = run !== ended && !!outgoing && duration > 0
  if (active) addKeyframes()
  useEffect(() => {
    if (run === ended) return
    const timer = window.setTimeout(() => setEnded(run), duration + 80)
    return () => window.clearTimeout(timer)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [run])
  const anim = active ? resolveSlideTransition(transition) : null
  // Perspective stays off once the transition has finished. A resting 3D layer
  // makes WebKit clip the text on the slide.
  return (
    <div className={anim ? 'slide-swap is-3d' : 'slide-swap'}>
      {anim && (
        <div key={`out-${run}`} className="slide-swap-layer" style={{ zIndex: anim.outgoingOnTop ? 2 : 0, animation: anim.outgoing !== 'none' ? anim.outgoing : undefined }}>
          {outgoing}
        </div>
      )}
      <div key={`in-${run}`} className="slide-swap-layer" style={{ zIndex: 1, animation: anim && anim.incoming !== 'none' ? anim.incoming : undefined }}>
        {incoming}
      </div>
    </div>
  )
}

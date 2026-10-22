import type { Transition } from './types'

type Kind = Transition['kind']

/** Transitions offered in the inspector; a deck may carry others, which play and show by name. */
export const TRANSITIONS: { value: Kind; label: string; directions?: boolean }[] = [
  { value: 'none', label: 'None' },
  { value: 'fade', label: 'Fade' },
  { value: 'push', label: 'Push', directions: true },
  { value: 'wipe', label: 'Wipe', directions: true },
  { value: 'cover', label: 'Cover', directions: true },
  { value: 'uncover', label: 'Uncover', directions: true },
  { value: 'split', label: 'Split' },
  { value: 'zoom', label: 'Zoom' },
  { value: 'dissolve', label: 'Dissolve' },
  { value: 'circle', label: 'Circle' },
  { value: 'flip', label: 'Flip', directions: true },
  { value: 'cube', label: 'Cube', directions: true },
]

// OOXML names the direction the new slide travels in: "l" slides in from the right.
export const DIRECTIONS = [
  { value: 'l', label: 'From right' },
  { value: 'r', label: 'From left' },
  { value: 'u', label: 'From bottom' },
  { value: 'd', label: 'From top' },
]

export const DEFAULT_DURATION_MS = 700

export function transitionLabel(t: Transition | undefined) {
  if (!t || !t.kind || t.kind === 'none' || t.kind === 'cut') return null
  const known = TRANSITIONS.find((o) => o.value === t.kind)
  return known?.label ?? t.kind[0].toUpperCase() + t.kind.slice(1).replace(/([A-Z])/g, ' $1').toLowerCase()
}

/** A new transition keeps the slide's timing and sound, and drops options that belonged to the old type. */
export function changeTransition(current: Transition | undefined, type: Kind): Transition | undefined {
  const timing = {
    ...(current?.onClick != null ? { onClick: current.onClick } : {}),
    ...(current?.afterMs != null ? { afterMs: current.afterMs } : {}),
  }
  if (type === 'none') return Object.keys(timing).length ? { kind: '', onClick: true, ...timing } : undefined
  const directions = TRANSITIONS.find((o) => o.value === type)?.directions
  return {
    kind: type,
    onClick: true,
    ...timing,
    durationMs: current?.durationMs ?? DEFAULT_DURATION_MS,
    ...(directions ? { direction: current?.direction && DIRECTIONS.some((d) => d.value === current.direction) ? current.direction : 'l' } : {}),
  }
}

export function resolveTransitionDurationMs(t: Transition | undefined): number {
  if (!t || !t.kind || t.kind === 'none' || t.kind === 'cut') return 0
  return Math.max(0, t.durationMs ?? DEFAULT_DURATION_MS)
}

const frames: string[] = []
const keyframe = (name: string, from: string, to: string) => {
  frames.push(`@keyframes ws-${name}{from{${from}}to{${to}}}`)
  return `ws-${name}`
}
const fade = keyframe('fade', 'opacity:0', 'opacity:1')
const zoom = keyframe('zoom', 'transform:scale(.2);opacity:0', 'transform:scale(1);opacity:1')
const split = keyframe('split', 'clip-path:inset(0 50%)', 'clip-path:inset(0)')
const circle = keyframe('circle', 'clip-path:circle(0% at 50% 50%)', 'clip-path:circle(75% at 50% 50%)')
// Small apertures open across the slide, then join into the complete incoming image.
const dissolve = 'ws-dissolve'
frames.push(`@keyframes ${dissolve}{${Array.from({ length: 11 }, (_, i) => {
  const radius = i * 7.2
  return `${i * 10}%{mask-image:radial-gradient(circle,#000 ${radius}%,transparent ${radius + 0.1}%);mask-size:24px 24px}`
}).join('')}}`)
const directional = Object.fromEntries(DIRECTIONS.map(({ value: d }) => {
  const horizontal = d === 'l' || d === 'r'
  const sign = d === 'l' || d === 'u' ? 1 : -1
  const axis = horizontal ? 'X' : 'Y'
  const enter = `translate${axis}(${sign * 100}%)`
  const leave = `translate${axis}(${-sign * 100}%)`
  const clip = { l: '0 0 0 100%', r: '0 100% 0 0', u: '100% 0 0 0', d: '0 0 100% 0' }[d]!
  const rotate = horizontal ? 'Y' : 'X'
  return [d, {
    incoming: keyframe(`in-${d}`, `transform:${enter}`, `transform:translate${axis}(0)`),
    outgoing: keyframe(`out-${d}`, `transform:translate${axis}(0)`, `transform:${leave}`),
    wipe: keyframe(`wipe-${d}`, `clip-path:inset(${clip})`, 'clip-path:inset(0)'),
    flipIn: keyframe(`flip-in-${d}`, `transform:rotate${rotate}(${sign * 90}deg);opacity:0`, `transform:rotate${rotate}(0);opacity:1`),
    flipOut: keyframe(`flip-out-${d}`, `transform:rotate${rotate}(0);opacity:1`, `transform:rotate${rotate}(${-sign * 90}deg);opacity:0`),
    cubeIn: keyframe(`cube-in-${d}`, `transform:${enter} rotate${rotate}(${sign * 90}deg);opacity:.5`, `transform:translate${axis}(0) rotate${rotate}(0);opacity:1`),
    cubeOut: keyframe(`cube-out-${d}`, `transform:translate${axis}(0) rotate${rotate}(0);opacity:1`, `transform:${leave} rotate${rotate}(${-sign * 90}deg);opacity:.5`),
  }]
}))
export const SLIDE_TRANSITION_KEYFRAMES = frames.join('\n')

export function resolveSlideTransition(t: Transition | undefined) {
  const duration = resolveTransitionDurationMs(t)
  if (!duration || !t) return null
  const d = directional[t.direction ?? 'l'] ?? directional.l
  const animation = (name: string) => `${name} ${duration}ms ease-in-out both`
  let incoming = 'none'
  let outgoing = 'none'
  let outgoingOnTop = false
  switch (t.kind) {
    case 'push': incoming = animation(d.incoming); outgoing = animation(d.outgoing); break
    case 'cover': incoming = animation(d.incoming); break
    case 'uncover': outgoing = animation(d.outgoing); outgoingOnTop = true; break
    case 'wipe': incoming = animation(d.wipe); break
    case 'split': incoming = animation(split); break
    case 'zoom': incoming = animation(zoom); break
    case 'circle': incoming = animation(circle); break
    case 'dissolve': incoming = animation(dissolve); break
    case 'flip': incoming = animation(d.flipIn); outgoing = animation(d.flipOut); break
    case 'cube': incoming = animation(d.cubeIn); outgoing = animation(d.cubeOut); break
    default: incoming = animation(fade)
  }
  return { incoming, outgoing, outgoingOnTop }
}

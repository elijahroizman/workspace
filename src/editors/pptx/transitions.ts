import type { Transition } from './types'

type Kind = Transition['type']

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
  if (!t || t.type === 'none' || t.type === 'cut') return null
  const known = TRANSITIONS.find((o) => o.value === t.type)
  return known?.label ?? t.type[0].toUpperCase() + t.type.slice(1).replace(/([A-Z])/g, ' $1').toLowerCase()
}

/** A new transition keeps the slide's timing and sound, and drops options that belonged to the old type. */
export function changeTransition(current: Transition | undefined, type: Kind): Transition | undefined {
  const timing = {
    ...(current?.advanceOnClick != null ? { advanceOnClick: current.advanceOnClick } : {}),
    ...(current?.advanceAfterMs != null ? { advanceAfterMs: current.advanceAfterMs } : {}),
  }
  if (type === 'none') return Object.keys(timing).length ? { type: 'none', ...timing } : undefined
  const directions = TRANSITIONS.find((o) => o.value === type)?.directions
  return {
    ...timing,
    type,
    durationMs: current?.durationMs ?? DEFAULT_DURATION_MS,
    ...(directions ? { direction: current?.direction && DIRECTIONS.some((d) => d.value === current.direction) ? current.direction : 'l' } : {}),
  }
}

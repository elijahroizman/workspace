// Reading a formula while it's typed: the function name being typed, the call the caret is in,
// and the cell references, for suggestions, argument hints and the colored boxes on the grid.

import { columnName } from './engine'

/** Where strings start and end, so names and references inside quotes are left alone. */
function stringSpans(text: string): [number, number][] {
  const spans: [number, number][] = []
  let i = 0
  while (i < text.length) {
    if (text[i] === '"') {
      const start = i++
      while (i < text.length) {
        if (text[i] === '"' && text[i + 1] === '"') i += 2
        else if (text[i] === '"') break
        else i++
      }
      spans.push([start, i])
    }
    i++
  }
  return spans
}

const inSpan = (spans: [number, number][], i: number) => spans.some(([a, b]) => i > a && i <= b)

/** The function name being typed before the caret, if a name can go there. */
export function nameAt(text: string, caret: number): { start: number; text: string } | null {
  if (!text.startsWith('=') || inSpan(stringSpans(text), caret)) return null
  const before = text.slice(0, caret)
  const m = /[A-Za-z_][A-Za-z0-9_.]*$/.exec(before)
  if (!m) return null
  const prev = before[m.index - 1]
  if (prev !== undefined && !'=(,+-*/^&<>; '.includes(prev)) return null
  // In the middle of a word, or a name already followed by its bracket.
  const after = text[caret]
  if (after !== undefined && /[A-Za-z0-9_.(!]/.test(after)) return null
  return { start: m.index, text: m[0] }
}

/** The function call the caret is inside, and which argument (from 0) it's in. */
export function callAt(text: string, caret: number): { name: string; arg: number } | null {
  if (!text.startsWith('=')) return null
  const stack: { name: string; arg: number }[] = []
  let i = 1
  while (i < caret) {
    const ch = text[i]
    if (ch === '"') {
      i++
      while (i < caret && !(text[i] === '"' && text[i + 1] !== '"')) i += text[i] === '"' ? 2 : 1
    } else if (ch === "'") {
      i++
      while (i < caret && text[i] !== "'") i++
    } else if (ch === '(') {
      const name = /[A-Za-z_][A-Za-z0-9_.]*$/.exec(text.slice(0, i))?.[0] ?? ''
      stack.push({ name: name.toUpperCase().replace(/^_XLFN\./, ''), arg: 0 })
    } else if (ch === ')') stack.pop()
    else if (ch === ',' && stack.length) stack[stack.length - 1].arg++
    i++
  }
  for (let k = stack.length - 1; k >= 0; k--) if (stack[k].name) return stack[k]
  return null
}

/** Whether a reference can go at the caret: after `=`, a bracket, a comma or an operator. */
export function canPointAt(text: string, caret: number): boolean {
  if (!text.startsWith('=') || inSpan(stringSpans(text), caret)) return false
  const before = text.slice(0, caret).trimEnd()
  const last = before[before.length - 1]
  const after = text.slice(caret).trimStart()[0]
  return last !== undefined && '=(,+-*/^&<>:;'.includes(last) && (after === undefined || ')+-*/^&<>,;:= '.includes(after))
}

export interface FormulaRef {
  start: number
  end: number
  sheet: string | null
  r0: number
  c0: number
  r1: number
  c1: number
}

const REF = /(?:(?:'((?:[^']|'')+)'|([A-Za-z_À-￿][\w.À-￿]*))!)?\$?([A-Za-z]{1,3})\$?([0-9]{1,7})(?::\$?([A-Za-z]{1,3})\$?([0-9]{1,7}))?/y

const colIndex = (letters: string) => [...letters.toUpperCase()].reduce((n, ch) => n * 26 + ch.charCodeAt(0) - 64, 0) - 1

/** The cell references in a formula, in order. */
export function refsIn(text: string): FormulaRef[] {
  if (!text.startsWith('=')) return []
  const spans = stringSpans(text)
  const out: FormulaRef[] = []
  for (let i = 1; i < text.length; i++) {
    if (text[i] === '"') {
      const span = spans.find(([a]) => a === i)
      if (span) i = span[1]
      continue
    }
    if (i > 0 && /[\w.$]/.test(text[i - 1])) continue
    REF.lastIndex = i
    const m = REF.exec(text)
    if (!m) continue
    const end = i + m[0].length
    if (end < text.length && /[\w(.!]/.test(text[end])) continue
    const r0 = Number(m[4]) - 1
    const c0 = colIndex(m[3])
    const r1 = m[6] ? Number(m[6]) - 1 : r0
    const c1 = m[5] ? colIndex(m[5]) : c0
    if (c0 > 16383 || c1 > 16383 || r0 < 0 || r1 < 0) continue
    out.push({ start: i, end, sheet: m[1]?.replace(/''/g, "'") ?? m[2] ?? null, r0: Math.min(r0, r1), c0: Math.min(c0, c1), r1: Math.max(r0, r1), c1: Math.max(c0, c1) })
    i = end - 1
  }
  return out
}

/** A sheet's name as a formula writes it. */
export function quoteSheet(name: string) {
  return /^[A-Za-z_][A-Za-z0-9_.]*$/.test(name) && !/^[A-Za-z]{1,3}[0-9]+$/.test(name) ? name : `'${name.replace(/'/g, "''")}'`
}

/** `B3`, or `B3:D7` for a block. */
export function a1(from: [number, number], to: [number, number]) {
  const [r0, r1] = [Math.min(from[0], to[0]), Math.max(from[0], to[0])]
  const [c0, c1] = [Math.min(from[1], to[1]), Math.max(from[1], to[1])]
  const cell = (r: number, c: number) => `${columnName(c)}${r + 1}`
  return r0 === r1 && c0 === c1 ? cell(r0, c0) : `${cell(r0, c0)}:${cell(r1, c1)}`
}

/** Colors for a formula's references, in order, as Excel colors them. */
export const REF_COLORS = ['#3b73e8', '#d9480f', '#8e44c9', '#0b8f6a', '#c2255c', '#b07d00', '#1098ad']

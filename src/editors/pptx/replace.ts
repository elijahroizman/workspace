import type { Element } from './types'

/** `text` with every `query` (any case, as Find matches) replaced by `by`. */
export function replaceText(text: string, query: string, by: string): string {
  if (!query) return text
  const lower = text.toLowerCase()
  const q = query.toLowerCase()
  let out = ''
  let from = 0
  for (let at = lower.indexOf(q); at !== -1; at = lower.indexOf(q, from)) {
    out += text.slice(from, at) + by
    from = at + q.length
  }
  return out + text.slice(from)
}

type Run = { text?: string }
type TextParts = { text?: string; textSegments?: Run[]; tableData?: { rows: { cells: (Run & { textRuns?: Run[] })[] }[] } }

const runs = <T extends Run>(list: T[], query: string, by: string) => list.map((r) => (r.text ? { ...r, text: replaceText(r.text, query, by) } : r))

/**
 * An object with `query` replaced in its text: a text box's or shape's runs, or a table's cells.
 * A match split between two differently formatted runs is left alone.
 */
export function replaceInElement(el: Element, query: string, by: string): Element {
  const parts = el as TextParts
  const next: TextParts = {}
  if (parts.textSegments?.length) {
    // The text follows the runs, so a match the runs couldn't replace still shows in Find.
    next.textSegments = runs(parts.textSegments, query, by)
    if (typeof parts.text === 'string') next.text = next.textSegments.map((s) => s.text ?? '').join('')
  } else if (typeof parts.text === 'string') {
    next.text = replaceText(parts.text, query, by)
  }
  if (parts.tableData) {
    next.tableData = {
      ...parts.tableData,
      rows: parts.tableData.rows.map((row) => ({
        ...row,
        cells: row.cells.map((cell) => ({
          ...cell,
          ...(cell.text ? { text: replaceText(cell.text, query, by) } : {}),
          ...(cell.textRuns ? { textRuns: runs(cell.textRuns, query, by) } : {}),
        })),
      })),
    }
  }
  return { ...el, ...next } as Element
}

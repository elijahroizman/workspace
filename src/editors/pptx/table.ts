import type { Element } from './types'

/** The engine's table model, narrowed from the element union. */
export type TableElement = Extract<Element, { type: 'table' }>
export type TableData = NonNullable<TableElement['tableData']>
type Row = TableData['rows'][number]
type Cell = Row['cells'][number]
type CellStyle = NonNullable<Cell['style']>

export const isTable = (el: Element | null | undefined): el is TableElement => el?.type === 'table'

/** A complete look for a table: header, alternating rows and rules. */
export interface TableLook {
  id: string
  label: string
  header: string
  headerText: string
  body: string
  band: string
  text: string
  line: string
  /** Only horizontal rules, no vertical ones. */
  open?: boolean
}

export const TABLE_LOOKS: TableLook[] = [
  { id: 'blue', label: 'Blue', header: '#2F6FEB', headerText: '#FFFFFF', body: '#FFFFFF', band: '#EEF3FD', text: '#1F2937', line: '#D6DEEE' },
  { id: 'slate', label: 'Slate', header: '#1F2937', headerText: '#FFFFFF', body: '#FFFFFF', band: '#F3F4F6', text: '#111827', line: '#E2E4E9' },
  { id: 'minimal', label: 'Minimal', header: '#FFFFFF', headerText: '#111111', body: '#FFFFFF', band: '#FFFFFF', text: '#333333', line: '#CFCFD4', open: true },
  { id: 'green', label: 'Green', header: '#16855A', headerText: '#FFFFFF', body: '#FFFFFF', band: '#EAF7F0', text: '#1F2937', line: '#D3E9DD' },
  { id: 'orange', label: 'Orange', header: '#E8642C', headerText: '#FFFFFF', body: '#FFFFFF', band: '#FDF1EA', text: '#1F2937', line: '#F2DCD0' },
  { id: 'purple', label: 'Purple', header: '#7149E0', headerText: '#FFFFFF', body: '#FFFFFF', band: '#F3EFFD', text: '#1F2937', line: '#E0D8F5' },
  { id: 'dark', label: 'Dark', header: '#000000', headerText: '#FFFFFF', body: '#1C1C1E', band: '#2A2A2D', text: '#F2F2F2', line: '#3A3A3D' },
]

/** A look built from the deck's own accent color, for decks made in PowerPoint. */
export function themeLook(accent: string | undefined): TableLook | null {
  const hex = accent?.replace('#', '')
  if (!hex || !/^[0-9a-f]{6}$/i.test(hex)) return null
  return { id: 'theme', label: 'Theme', header: `#${hex.toUpperCase()}`, headerText: '#FFFFFF', body: '#FFFFFF', band: mix(hex, 0.88), text: '#1F2937', line: mix(hex, 0.78) }
}

function mix(hex: string, white: number) {
  const channel = (i: number) => {
    const v = parseInt(hex.slice(i, i + 2), 16)
    return Math.round(v + (255 - v) * white)
      .toString(16)
      .padStart(2, '0')
  }
  return `#${channel(0)}${channel(2)}${channel(4)}`.toUpperCase()
}

/** Which look a table currently wears, judged by its header and first body row. */
export function currentLook(data: TableData, looks: TableLook[]): TableLook | null {
  const header = data.rows[0]?.cells[0]?.style
  return looks.find((l) => same(header?.backgroundColor, data.firstRowHeader === false ? l.body : l.header) && same(header?.color, data.firstRowHeader === false ? l.text : l.headerText)) ?? null
}

const same = (a: string | undefined, b: string) => a?.toUpperCase() === b.toUpperCase()

/** Paint every cell with a look. Formatting the look doesn't own (font, size, alignment) is kept. */
export function applyLook(data: TableData, look: TableLook, opts: { header: boolean; banded: boolean }): TableData {
  const lastCol = data.columnWidths.length - 1
  const rows = data.rows.map((row, r) => {
    const isHeader = opts.header && r === 0
    const bodyIndex = opts.header ? r - 1 : r
    const fill = isHeader ? look.header : opts.banded && bodyIndex % 2 === 0 ? look.band : look.body
    return {
      ...row,
      cells: row.cells.map((cell, c) => {
        const style: CellStyle = { ...withoutLook(cell.style) }
        style.backgroundColor = fill
        style.color = isHeader ? look.headerText : look.text
        if (r === 0) style.bold = isHeader || undefined
        const vertical = look.open ? 0 : 1
        Object.assign(style, {
          borderTopWidth: 1,
          borderBottomWidth: 1,
          borderLeftWidth: c === 0 && look.open ? 0 : vertical,
          borderRightWidth: c === lastCol && look.open ? 0 : vertical,
          borderTopColor: look.line,
          borderBottomColor: isHeader && look.open ? look.text : look.line,
          borderLeftColor: look.line,
          borderRightColor: look.line,
        })
        // Run colors from editing would hide the look's text color.
        const textRuns = cell.textRuns?.map(({ color: _color, ...run }) => run)
        return { ...cell, style, ...(textRuns ? { textRuns } : {}) }
      }),
    }
  })
  return { ...data, rows, firstRowHeader: opts.header, bandedRows: opts.banded, tableStyleId: undefined }
}

/** Drop the colors, fills and borders a look sets, including the theme references that would override them. */
function withoutLook(style: CellStyle | undefined): CellStyle {
  if (!style) return {}
  const next = { ...style } as Record<string, unknown>
  for (const key of Object.keys(next)) {
    if (/^(color|background|border)/.test(key) || key === 'gradientFillCss' || key === 'fillMode') delete next[key]
  }
  return next as CellStyle
}

/** Set text formatting on every cell (and its runs, so earlier edits don't win). */
export function styleAllCells(data: TableData, patch: Partial<Pick<CellStyle, 'fontSize' | 'fontFamily' | 'align' | 'vAlign'>>): TableData {
  const runKeys = (['fontSize', 'fontFamily'] as const).filter((k) => k in patch)
  return {
    ...data,
    rows: data.rows.map((row) => ({
      ...row,
      cells: row.cells.map((cell) => ({
        ...cell,
        style: { ...cell.style, ...patch },
        ...(cell.textRuns && runKeys.length
          ? {
              textRuns: cell.textRuns.map((run) => {
                const next = { ...run }
                for (const k of runKeys) delete next[k]
                return next
              }),
            }
          : {}),
      })),
    })),
  }
}

/** Add or remove rows at the bottom. New rows copy the formatting of the row two above, keeping bands. */
export function resizeRows(data: TableData, count: number): TableData {
  const rows = data.rows.slice(0, Math.max(1, count))
  while (rows.length < count) {
    const source = rows[rows.length - 2] ?? rows[rows.length - 1]
    rows.push({ ...source, cells: source.cells.map((cell) => blankCell(cell)) })
  }
  return { ...data, rows }
}

/** Add or remove columns at the right, keeping the table's total width. */
export function resizeColumns(data: TableData, count: number): TableData {
  const total = data.columnWidths.reduce((a, b) => a + b, 0) || 1
  let widths = data.columnWidths.slice(0, Math.max(1, count))
  while (widths.length < count) widths = [...widths, total / data.columnWidths.length]
  const sum = widths.reduce((a, b) => a + b, 0)
  return {
    ...data,
    columnWidths: widths.map((w) => (w * total) / sum),
    rows: data.rows.map((row) => {
      const cells = row.cells.slice(0, widths.length)
      while (cells.length < widths.length) cells.push(blankCell(cells[cells.length - 1]))
      return { ...row, cells }
    }),
  }
}

function blankCell(like: Cell | undefined): Cell {
  return { text: '', style: { ...like?.style } }
}

export const rowsHeight = (data: TableData) => data.rows.reduce((sum, r) => sum + (r.height ?? 0), 0)

/** Stretch or squeeze the rows to fill a new frame height. */
export function fitRowsTo(data: TableData, height: number): TableData {
  const current = rowsHeight(data)
  if (!current || !height) return data
  const scale = height / current
  return { ...data, rows: data.rows.map((r) => ({ ...r, height: Math.max(8, Math.round((r.height ?? current / data.rows.length) * scale)) })) }
}

/** A new table sized for the slide, wearing a look. */
export function newTable(rows: number, cols: number, slide: { width: number; height: number }, look: TableLook, fontFamily?: string): Omit<TableElement, 'id'> {
  const width = Math.round(slide.width * 0.8)
  const rowHeight = Math.max(24, Math.min(Math.round(slide.height * 0.075), Math.floor((slide.height * 0.84) / rows)))
  const fontSize = rowHeight >= 44 ? 18 : rowHeight >= 34 ? 14 : 11
  const height = rowHeight * rows
  const data: TableData = {
    columnWidths: Array.from({ length: cols }, () => 1 / cols),
    rows: Array.from({ length: rows }, (_, r) => ({
      height: rowHeight,
      cells: Array.from({ length: cols }, (_, c) => ({
        text: r === 0 && rows > 1 ? `Heading ${c + 1}` : '',
        style: { fontSize, vAlign: 'middle' as const, ...(fontFamily ? { fontFamily } : {}) },
      })),
    })),
  }
  return {
    type: 'table',
    name: 'Table',
    x: Math.round((slide.width - width) / 2),
    y: Math.round(Math.max(slide.height * 0.08, (slide.height - height) / 2)),
    width,
    height,
    tableData: applyLook(data, look, { header: rows > 1, banded: true }),
  } as Omit<TableElement, 'id'>
}

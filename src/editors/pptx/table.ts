import type { Element } from './types'

export const isTable = (el: Element | null | undefined): el is Element => el?.type === 'table'

/** The existing swatches, backed by PowerPoint's built-in table style identifiers. */
export interface TableLook {
  id: string
  label: string
  style: string
  header: string
  headerText: string
  body: string
  band: string
  text: string
  line: string
  open?: boolean
}

export const TABLE_LOOKS: TableLook[] = [
  { id: 'blue', label: 'Blue', style: '{5C22544A-7EE6-4342-B048-85BDC9FD1C3A}', header: '#2F6FEB', headerText: '#FFFFFF', body: '#FFFFFF', band: '#EEF3FD', text: '#1F2937', line: '#D6DEEE' },
  { id: 'slate', label: 'Slate', style: '{9D7B26C5-4107-4FEC-AEDC-1716B250A1EF}', header: '#1F2937', headerText: '#FFFFFF', body: '#FFFFFF', band: '#F3F4F6', text: '#111827', line: '#E2E4E9' },
  { id: 'minimal', label: 'Minimal', style: '{2D5ABB26-0587-4C30-8999-92F81FD0307C}', header: '#FFFFFF', headerText: '#111111', body: '#FFFFFF', band: '#FFFFFF', text: '#333333', line: '#CFCFD4', open: true },
  { id: 'green', label: 'Green', style: '{93296810-A885-4BE3-A3E7-6D5BEEA58F35}', header: '#16855A', headerText: '#FFFFFF', body: '#FFFFFF', band: '#EAF7F0', text: '#1F2937', line: '#D3E9DD' },
  { id: 'orange', label: 'Orange', style: '{21E4AEA4-8DFA-4A89-87EB-49C32662AFE0}', header: '#E8642C', headerText: '#FFFFFF', body: '#FFFFFF', band: '#FDF1EA', text: '#1F2937', line: '#F2DCD0' },
  { id: 'purple', label: 'Purple', style: '{7DF18680-E054-41AD-8BC1-D1AEF772440D}', header: '#7149E0', headerText: '#FFFFFF', body: '#FFFFFF', band: '#F3EFFD', text: '#1F2937', line: '#E0D8F5' },
  { id: 'dark', label: 'Dark', style: '{E8034E78-7F5D-4C2E-B375-FC64B27BC917}', header: '#000000', headerText: '#FFFFFF', body: '#1C1C1E', band: '#2A2A2D', text: '#F2F2F2', line: '#3A3A3D' },
]

export function themeLook(accent: string | undefined): TableLook | null {
  const hex = accent?.replace('#', '')
  if (!hex || !/^[0-9a-f]{6}$/i.test(hex)) return null
  const mix = (white: number) => `#${[0, 2, 4].map((i) => Math.round(parseInt(hex.slice(i, i + 2), 16) * (1 - white) + 255 * white).toString(16).padStart(2, '0')).join('')}`.toUpperCase()
  return { id: 'theme', label: 'Theme', style: TABLE_LOOKS[0].style, header: `#${hex.toUpperCase()}`, headerText: '#FFFFFF', body: '#FFFFFF', band: mix(0.88), text: '#1F2937', line: mix(0.78) }
}

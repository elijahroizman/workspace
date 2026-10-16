export type DocKind = 'docx' | 'pptx' | 'pdf' | 'md' | 'txt'

export interface KindInfo {
  label: string
  short: string
  extensions: string[]
  /** CSS custom property used for this kind's accent dot. */
  color: string
  untitled: string
}

export const KINDS: Record<DocKind, KindInfo> = {
  docx: {
    label: 'Word Document',
    short: 'Document',
    extensions: ['docx'],
    color: 'var(--kind-docx)',
    untitled: 'Untitled Document',
  },
  pptx: {
    label: 'PowerPoint Presentation',
    short: 'Presentation',
    extensions: ['pptx'],
    color: 'var(--kind-pptx)',
    untitled: 'Untitled Presentation',
  },
  pdf: {
    label: 'PDF Document',
    short: 'PDF',
    extensions: ['pdf'],
    color: 'var(--kind-pdf)',
    untitled: 'Untitled',
  },
  md: {
    label: 'Markdown',
    short: 'Markdown',
    extensions: ['md', 'markdown'],
    color: 'var(--kind-md)',
    untitled: 'Untitled Note',
  },
  txt: {
    label: 'Plain Text',
    short: 'Text',
    extensions: ['txt'],
    color: 'var(--kind-txt)',
    untitled: 'Untitled Text',
  },
}

export function kindFromPath(path: string): DocKind | null {
  const ext = path.split('.').pop()?.toLowerCase() ?? ''
  for (const [kind, info] of Object.entries(KINDS) as [DocKind, KindInfo][]) {
    if (info.extensions.includes(ext)) return kind
  }
  return null
}

export function stripExtension(name: string): string {
  const kind = kindFromPath(name)
  if (!kind) return name
  return name.replace(/\.[^.]+$/, '')
}

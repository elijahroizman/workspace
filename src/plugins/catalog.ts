// Every plugin Workspace knows about. Built-in plugins ship with the app and are always on.
// Optional ones are off until turned on in Settings or the setup screen:
//  - `bundled` plugins are small, so their files come with the app and turning one on is instant.
//  - `download` plugins are too big to make everyone download (Excalidraw's fonts alone are 14 MB).
//    Turning one on fetches a signed archive from the Workspace GitHub release (see
//    src-tauri/src/plugins.rs and plugins/README.md).
// A plugin bigger than about 1 MB should be a download.

import type { ComponentType } from 'react'
import { BookOpen, FileCode2, FileText, FileType2, Image as ImageIcon, NotepadText, Presentation, Sigma, Workflow } from 'lucide-react'
import excalidraw from '../../plugins/excalidraw/plugin.json'
import latex from '../../plugins/latex/plugin.json'
import mermaid from '../../plugins/mermaid/plugin.json'
import { ExcalidrawIcon } from './icons'

export interface KindInfo {
  id: string
  label: string
  short: string
  /** In a sentence: “Open Word, PowerPoint and PDF files.” */
  prose: string
  extensions: string[]
  /** CSS custom property used for this kind's accent dot. */
  color: string
  icon: ComponentType<{ size?: number; strokeWidth?: number }>
  untitled: string
  /** The Home screen's “New …” card; none means you can't create one from scratch. */
  create?: { title: string; hint: string }
  /**
   * Whether the sidebar and inspector start open. An optional plugin's kind has a sidebar (the
   * editor's `context.sidebar`) only if `left` is true, and never an inspector.
   */
  panels: { left: boolean; right: boolean }
}

export interface PluginInfo {
  id: string
  name: string
  description: string
  kinds: KindInfo[]
  /** The engines' licenses, as SPDX ids (the full texts are in Settings › General › Licenses). */
  license: string
  homepage: string
  /** What the plugin's editor gets from Workspace beyond the basics (see context.tex in api.ts). */
  services?: 'tex'[]
  /** Built in: always on. Otherwise how its files arrive. */
  source:
    | { type: 'builtin' }
    | { type: 'bundled' }
    | {
        type: 'download'
        /** The plugin's own version; a new one is downloaded when this changes. */
        version: string
        /** Download size in bytes, shown before installing. */
        size: number
      }
}

export const PLUGINS: PluginInfo[] = [
  {
    id: 'office',
    name: 'Office',
    description: 'Word documents and PowerPoint presentations. Excel workbooks are coming.',
    homepage: 'https://github.com/eigenpal/docx-editor',
    license: 'Apache-2.0',
    source: { type: 'builtin' },
    kinds: [
      {
        id: 'docx',
        prose: 'Word',
        label: 'Word Document',
        short: 'Document',
        extensions: ['docx'],
        color: 'var(--kind-docx)',
        icon: FileText,
        untitled: 'Untitled Document',
        create: { title: 'New document', hint: 'Word (.docx)' },
        panels: { left: true, right: true },
      },
      {
        id: 'pptx',
        prose: 'PowerPoint',
        label: 'PowerPoint Presentation',
        short: 'Presentation',
        extensions: ['pptx'],
        color: 'var(--kind-pptx)',
        icon: Presentation,
        untitled: 'Untitled Presentation',
        create: { title: 'New presentation', hint: 'PowerPoint (.pptx)' },
        panels: { left: true, right: true },
      },
    ],
  },
  {
    id: 'pdf',
    name: 'PDF',
    description: 'Read, annotate, fill in and rearrange PDFs, on PDFium.',
    homepage: 'https://pdfium.googlesource.com/pdfium/',
    license: 'BSD-3-Clause, MIT',
    source: { type: 'builtin' },
    kinds: [
      {
        id: 'pdf',
        prose: 'PDF',
        label: 'PDF Document',
        short: 'PDF',
        extensions: ['pdf'],
        color: 'var(--kind-pdf)',
        icon: FileType2,
        untitled: 'Untitled',
        panels: { left: true, right: true },
      },
    ],
  },
  {
    id: 'markdown',
    name: 'Markdown',
    description: 'Write and preview Markdown notes.',
    homepage: 'https://github.com/markdown-it/markdown-it',
    license: 'MIT',
    source: { type: 'builtin' },
    kinds: [
      {
        id: 'md',
        prose: 'Markdown',
        label: 'Markdown',
        short: 'Markdown',
        extensions: ['md', 'markdown'],
        color: 'var(--kind-md)',
        icon: FileCode2,
        untitled: 'Untitled Note',
        create: { title: 'New note', hint: 'Markdown (.md)' },
        // Markdown is mostly for reading, so its inspector starts hidden.
        panels: { left: true, right: false },
      },
    ],
  },
  {
    id: 'text',
    name: 'Plain text',
    description: 'Plain text files, without sidebars.',
    homepage: 'https://codemirror.net',
    license: 'MIT',
    source: { type: 'builtin' },
    kinds: [
      {
        id: 'txt',
        prose: 'text',
        label: 'Plain Text',
        short: 'Text',
        extensions: ['txt'],
        color: 'var(--kind-txt)',
        icon: NotepadText,
        untitled: 'Untitled Text',
        create: { title: 'New text file', hint: 'Plain text (.txt)' },
        panels: { left: false, right: false },
      },
    ],
  },
  {
    id: 'excalidraw',
    name: 'Excalidraw',
    description: 'Hand-drawn style diagrams, sketches and whiteboards.',
    homepage: 'https://excalidraw.com',
    license: 'MIT',
    source: { type: 'download', version: excalidraw.version, size: excalidraw.size },
    kinds: [
      {
        id: 'excalidraw',
        prose: 'Excalidraw',
        label: 'Excalidraw Drawing',
        short: 'Drawing',
        extensions: ['excalidraw'],
        color: 'var(--kind-excalidraw)',
        icon: ExcalidrawIcon,
        untitled: 'Untitled Drawing',
        create: { title: 'New drawing', hint: 'Excalidraw (.excalidraw)' },
        panels: { left: false, right: false },
      },
    ],
  },
  {
    id: 'epub',
    name: 'EPUB',
    description: 'Read EPUB books, with their table of contents. Workspace remembers your place.',
    homepage: 'https://github.com/elijahroizman/workspace/tree/main/plugins/epub',
    license: 'MIT, (MPL-2.0 OR Apache-2.0)',
    source: { type: 'bundled' },
    kinds: [
      {
        id: 'epub',
        prose: 'EPUB',
        label: 'EPUB Book',
        short: 'Book',
        extensions: ['epub'],
        color: 'var(--kind-epub)',
        icon: BookOpen,
        untitled: 'Untitled Book',
        panels: { left: true, right: false },
      },
    ],
  },
  {
    id: 'images',
    name: 'Images',
    description: 'A simple viewer for PNG, JPEG and HEIC pictures, with highlighting, drawing, cropping and turning.',
    homepage: 'https://github.com/elijahroizman/workspace/tree/main/plugins/images',
    license: 'MIT, LGPL-3.0',
    source: { type: 'bundled' },
    kinds: [
      {
        id: 'image',
        prose: 'image',
        label: 'Image',
        short: 'Image',
        extensions: ['png', 'jpg', 'jpeg', 'heic', 'heif'],
        color: 'var(--kind-image)',
        icon: ImageIcon,
        untitled: 'Untitled Image',
        panels: { left: false, right: false },
      },
    ],
  },
  {
    id: 'mermaid',
    name: 'Mermaid',
    description: 'Flowcharts, sequence diagrams, Gantt charts and more, written as text and drawn as you type.',
    homepage: 'https://mermaid.js.org',
    license: 'MIT',
    source: { type: 'download', version: mermaid.version, size: mermaid.size },
    kinds: [
      {
        id: 'mermaid',
        prose: 'Mermaid',
        label: 'Mermaid Diagram',
        short: 'Diagram',
        extensions: ['mmd', 'mermaid'],
        color: 'var(--kind-mermaid)',
        icon: Workflow,
        untitled: 'Untitled Diagram',
        create: { title: 'New diagram', hint: 'Mermaid (.mmd)' },
        panels: { left: true, right: false },
      },
    ],
  },
  {
    id: 'latex',
    name: 'LaTeX',
    description: 'Write LaTeX and watch the PDF update as you go. Compiles with the TeX on your computer (MacTeX, MiKTeX or TeX Live), which Workspace can install.',
    homepage: 'https://www.latex-project.org',
    license: 'MIT',
    services: ['tex'],
    source: { type: 'download', version: latex.version, size: latex.size },
    kinds: [
      {
        id: 'latex',
        prose: 'LaTeX',
        label: 'LaTeX Document',
        short: 'LaTeX',
        extensions: ['tex'],
        color: 'var(--kind-latex)',
        icon: Sigma,
        untitled: 'Untitled LaTeX',
        create: { title: 'New LaTeX document', hint: 'LaTeX (.tex)' },
        panels: { left: true, right: false },
      },
    ],
  },
]

export const pluginById = (id: string) => PLUGINS.find((p) => p.id === id)
export const pluginForKind = (kind: string) => PLUGINS.find((p) => p.kinds.some((k) => k.id === kind))!
export const isBuiltIn = (plugin: PluginInfo) => plugin.source.type === 'builtin'

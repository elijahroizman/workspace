// The document's structure for the sidebar: \part … \subsubsection, with their lines.

export interface Heading {
  level: number
  title: string
  line: number
}

const LEVELS: Record<string, number> = { part: 0, chapter: 1, section: 2, subsection: 3, subsubsection: 4, paragraph: 5 }
const HEADING = /\\(part|chapter|section|subsection|subsubsection|paragraph)\*?\s*(?:\[[^\]]*\])?\s*\{/g

export function outline(text: string): Heading[] {
  const headings: Heading[] = []
  const lines = text.split('\n')
  for (let i = 0; i < lines.length; i++) {
    const line = withoutComment(lines[i])
    for (const match of line.matchAll(HEADING)) {
      const title = balanced(line, match.index! + match[0].length)
      if (title !== null) headings.push({ level: LEVELS[match[1]], title: tidy(title), line: i + 1 })
    }
  }
  return headings
}

/** A line up to its first unescaped %. */
function withoutComment(line: string) {
  for (let i = 0; i < line.length; i++) {
    if (line[i] === '\\') i++
    else if (line[i] === '%') return line.slice(0, i)
  }
  return line
}

/** The text up to the brace that closes the one just before `start`, if it's on this line. */
function balanced(line: string, start: number): string | null {
  let depth = 1
  for (let i = start; i < line.length; i++) {
    if (line[i] === '\\') i++
    else if (line[i] === '{') depth++
    else if (line[i] === '}' && --depth === 0) return line.slice(start, i)
  }
  return null
}

/** Readable text from a title's markup: `\emph{x}` → x, `~` → space, math kept as written. */
function tidy(title: string) {
  return (
    title
      .replace(/\\(?:emph|textbf|textit|texttt|textsc|underline|mbox)\s*\{([^{}]*)\}/g, '$1')
      .replace(/\\(?:label|index|footnote)\s*\{[^{}]*\}/g, '')
      .replace(/~/g, ' ')
      .replace(/\\([&%$#_{}])/g, '$1')
      .replace(/\s+/g, ' ')
      .trim() || 'Untitled'
  )
}

/** `% !TEX program = xelatex` (TeXShop, VS Code and others read it too). */
export function magicEngine(text: string): string | null {
  const head = text.split('\n', 30)
  for (const line of head) {
    const match = /^\s*%\s*!\s*TEX\s+(?:TS-)?program\s*=\s*(\w+)/i.exec(line)
    if (match) return match[1].toLowerCase()
  }
  return null
}

/** The engine a document without a magic comment needs: fontspec and friends want XeLaTeX. */
export function guessEngine(text: string): 'pdflatex' | 'xelatex' {
  return /\\usepackage(?:\[[^\]]*\])?\{[^}]*\b(?:fontspec|unicode-math|polyglossia|xeCJK)\b/.test(text) ? 'xelatex' : 'pdflatex'
}

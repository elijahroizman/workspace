// Errors and warnings from a TeX log. TeX runs with -file-line-error, so an error in a file
// reads `path:line: message`; warnings say `on input line N`. The Rust side sets
// max_print_line so a message isn't wrapped over several lines (TeX Live honours it; MiKTeX
// may still wrap long ones, which only shortens the message).

export interface Problem {
  severity: 'error' | 'warning'
  message: string
  /** 1-based line in the document, when the problem is in the document itself. */
  line?: number
  /** Another file (an \input chapter, a package) the problem is in. */
  file?: string
}

const FILE_LINE = /^(.+?\.(?:tex|sty|cls|bib|ltx|dtx|def|cfg|clo|fd)):(\d+): (.*)$/
const INPUT_LINE = /on input line (\d+)\.?/
/** What TeX says after the error that matters. */
const NOISE = /^\s*(?:Emergency stop|==> Fatal error|Job aborted)/
const WARNING = /^(?:LaTeX|Package [\w-]+|Class [\w-]+|pdfTeX) warning: (.*)$/i

/** `file` is the path TeX compiled (TexResult.file): errors in it are the document's own. */
export function parseLog(log: string, file: string): Problem[] {
  const problems: Problem[] = []
  const seen = new Set<string>()
  const add = (problem: Problem) => {
    if (NOISE.test(problem.message)) return
    const key = `${problem.severity}:${problem.line}:${problem.file}:${problem.message}`
    if (seen.has(key)) return
    seen.add(key)
    problems.push(problem)
  }
  const own = (path: string) => samePath(path, file)
  const lines = log.split(/\r?\n/)
  for (let i = 0; i < lines.length; i++) {
    const text = lines[i]
    const located = FILE_LINE.exec(text)
    if (located) {
      const [, path, line, message] = located
      add({ severity: 'error', message: withDetail(message, lines, i), ...(own(path) ? { line: Number(line) } : { file: basename(path) }) })
      continue
    }
    if (text.includes('no legal \\end found')) {
      add({ severity: 'error', message: 'The document stops before \\end{document}.' })
      continue
    }
    if (text.startsWith('! ')) {
      add({ severity: 'error', message: withDetail(text.slice(2), lines, i), line: errorLine(lines, i) })
      continue
    }
    const warning = WARNING.exec(text)
    if (warning) {
      // A package warning carries on over lines that start with `(package)`.
      let message = warning[1]
      for (let j = i + 1; j < lines.length && /^\([\w-]+\)\s/.test(lines[j]); j++) message += ' ' + lines[j].replace(/^\([\w-]+\)\s+/, '')
      const at = INPUT_LINE.exec(message)
      add({ severity: 'warning', message: message.replace(INPUT_LINE, '').replace(/\s+/g, ' ').trim(), line: at ? Number(at[1]) : undefined })
    }
  }
  // Errors first; each kind in the order TeX met them.
  return [...problems.filter((p) => p.severity === 'error'), ...problems.filter((p) => p.severity === 'warning')]
}

/** "Undefined control sequence" says which: TeX shows the offending text on the next line. */
function withDetail(message: string, lines: string[], i: number) {
  const next = lines[i + 1] ?? ''
  const shown = /^l\.\d+ (.*)$/.exec(next)
  if (/Undefined control sequence/.test(message) && shown) {
    const command = /\\[A-Za-z@]+$/.exec(shown[1].trimEnd())
    if (command) return `${message.replace(/\.$/, '')}: ${command[0]}`
  }
  return message
}

/** Without -file-line-error's prefix (a fatal error), TeX still prints `l.12 …` after it. */
function errorLine(lines: string[], i: number): number | undefined {
  for (let j = i + 1; j < Math.min(lines.length, i + 12); j++) {
    const at = /^l\.(\d+)/.exec(lines[j])
    if (at) return Number(at[1])
  }
  return undefined
}

const normalize = (path: string) => path.replace(/\\/g, '/').replace(/^\.\//, '')
const basename = (path: string) => normalize(path).split('/').pop() ?? path
const samePath = (a: string, b: string) => normalize(a) === normalize(b) || (basename(a) === basename(b) && !normalize(a).includes('/'))

import DOMPurify from 'dompurify'
import hljs from 'highlight.js/lib/common'
import MarkdownIt from 'markdown-it'
import anchor from 'markdown-it-anchor'
// @ts-expect-error: no bundled types
import taskLists from 'markdown-it-task-lists'

const escapeHtml = (s: string) => s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!)

export interface Heading {
  level: number
  text: string
  slug: string
  line: number
}

export const slugify = (s: string) =>
  s
    .trim()
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s-]/gu, '')
    .replace(/\s+/g, '-')

const md = new MarkdownIt({
  html: true,
  linkify: true,
  typographer: true,
  highlight(code: string, lang: string): string {
    if (lang && hljs.getLanguage(lang)) {
      try {
        return `<pre class="hljs"><code>${hljs.highlight(code, { language: lang, ignoreIllegals: true }).value}</code></pre>`
      } catch {
        /* fall through */
      }
    }
    return `<pre class="hljs"><code>${escapeHtml(code)}</code></pre>`
  },
})
  .use(anchor, { slugify })
  .use(taskLists, { enabled: false, label: true })

// Tag top-level blocks with their source line so the preview can follow the editor's scroll.
md.core.ruler.push('source_lines', (state) => {
  for (const token of state.tokens) {
    if (token.map && token.nesting !== -1 && token.level === 0) token.attrSet('data-line', String(token.map[0]))
  }
})

export function renderMarkdown(source: string): { html: string; headings: Heading[] } {
  const env = {}
  const tokens = md.parse(source, env)
  const headings: Heading[] = []
  tokens.forEach((token, i) => {
    if (token.type === 'heading_open') {
      const inline = tokens[i + 1]
      const text = inline?.children?.map((c) => c.content).join('') ?? inline?.content ?? ''
      headings.push({
        level: Number(token.tag.slice(1)),
        text,
        slug: String(token.attrGet('id') ?? slugify(text)),
        line: token.map?.[0] ?? 0,
      })
    }
  })
  const html = DOMPurify.sanitize(md.renderer.render(tokens, md.options, env), {
    ADD_ATTR: ['data-line', 'target'],
    // Inline <script>/<style>/forms from untrusted files never run.
    FORBID_TAGS: ['style', 'form'],
  })
  return { html, headings }
}

export function stats(source: string) {
  const text = source
    .replace(/```[\s\S]*?```/g, ' ')
    .replace(/`[^`]*`/g, ' ')
    .replace(/!\[[^\]]*\]\([^)]*\)/g, ' ')
    .replace(/\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/[#>*_~`-]/g, ' ')
  const words = text.split(/\s+/).filter(Boolean).length
  return {
    words,
    characters: source.length,
    lines: source.split('\n').length,
    minutes: Math.max(1, Math.round(words / 230)),
  }
}

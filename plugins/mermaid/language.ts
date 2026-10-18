// Highlighting for Mermaid in CodeMirror: diagram types, statement keywords, arrows, strings,
// |edge labels| and %% comments. Mermaid has no grammar CodeMirror ships, and a stream parser is
// plenty for one-diagram files.

import { HighlightStyle, StreamLanguage } from '@codemirror/language'
import { tags } from '@lezer/highlight'

const DIAGRAMS = new Set(
  'graph flowchart sequenceDiagram classDiagram stateDiagram stateDiagram-v2 erDiagram gantt pie journey gitGraph mindmap timeline quadrantChart sankey-beta xychart-beta block-beta requirementDiagram C4Context C4Container C4Component C4Dynamic C4Deployment architecture-beta kanban packet-beta radar-beta treemap-beta'.split(' '),
)
const KEYWORDS = new Set(
  'subgraph end participant actor loop alt else opt par and critical break rect note over title section dateFormat axisFormat excludes todayMarker click style classDef class linkStyle direction autonumber activate deactivate accTitle accDescr commit branch checkout merge cherry-pick state as of left right TD TB BT RL LR'.split(' '),
)

export const mermaidLanguage = StreamLanguage.define<{ started: boolean }>({
  name: 'mermaid',
  startState: () => ({ started: false }),
  token(stream, state) {
    if (stream.eatSpace()) return null
    if (stream.match('%%')) {
      stream.skipToEnd()
      return 'comment'
    }
    if (stream.match(/^"(?:[^"\\]|\\.)*"?/)) return 'string'
    if (stream.match(/^\|[^|]*\|?/)) return 'string'
    if (stream.match(/^(?:<?[-=.]+(?:>>?|x|o|\)|\|>)?|[<|*o]?[-.]{2,}[>|*o]?|:::?)/)) return 'operator'
    const word = stream.match(/^[A-Za-z][\w-]*/) as RegExpMatchArray | null
    if (word) {
      if (!state.started && DIAGRAMS.has(word[0])) {
        state.started = true
        return 'keyword'
      }
      if (KEYWORDS.has(word[0])) return 'keyword'
      return 'variableName'
    }
    if (stream.match(/^\d+(?:\.\d+)?/)) return 'number'
    if (stream.match(/^[[\](){}]+/)) return 'bracket'
    stream.next()
    return null
  },
})

export const highlight = HighlightStyle.define([
  { tag: tags.keyword, color: '#c678dd' },
  { tag: tags.operator, color: '#56b6c2' },
  { tag: tags.string, color: '#98c379' },
  { tag: tags.number, color: '#d19a66' },
  { tag: tags.bracket, color: 'var(--fg-muted)' },
  { tag: tags.comment, color: 'var(--fg-faint)', fontStyle: 'italic' },
])

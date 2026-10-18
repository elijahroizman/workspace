// Starting points for the sidebar's "Start from a template". A Mermaid file holds one diagram,
// so picking one replaces the document (⌘Z brings it back).

export const TEMPLATES: Record<string, string> = {
  Flowchart: `flowchart TD
  A[Start] --> B[Process]
  B --> C{Decision}
  C -->|Yes| D[End]
  C -->|No| B
`,
  Sequence: `sequenceDiagram
  participant Alice
  participant Bob
  Alice->>Bob: Hello
  Bob-->>Alice: Hi
`,
  Class: `classDiagram
  class Animal {
    +String name
    +eat()
  }
  class Dog {
    +bark()
  }
  Animal <|-- Dog
`,
  State: `stateDiagram-v2
  [*] --> Idle
  Idle --> Processing
  Processing --> Done
  Done --> [*]
`,
  'Entity relationship': `erDiagram
  CUSTOMER ||--o{ ORDER : places
  ORDER ||--|{ LINE_ITEM : contains
  PRODUCT ||--o{ LINE_ITEM : "is in"
`,
  Gantt: `gantt
  title Project Timeline
  dateFormat YYYY-MM-DD
  section Phase 1
  Task 1 :t1, 2026-01-01, 5d
  Task 2 :t2, after t1, 3d
`,
  Pie: `pie title Tasks Distribution
  "Development" : 40
  "Testing" : 30
  "Documentation" : 20
  "Review" : 10
`,
  Mindmap: `mindmap
  root((Project))
    Features
      UI
      API
    Planning
      Research
      Design
`,
  Timeline: `timeline
  title Project History
  2026-01 : Start
  2026-02 : MVP
  2026-03 : Launch
`,
  'Git graph': `gitGraph
  commit
  commit
  branch develop
  checkout develop
  commit
  checkout main
  merge develop
`,
}

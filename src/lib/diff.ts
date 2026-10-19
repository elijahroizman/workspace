// Line diffs for version history: Myers' O(ND) algorithm, the one Git uses by default.

export type DiffOp = { type: 'same' | 'add' | 'del'; text: string }

/** The edit script turning `a` into `b`, line by line. Null when they differ too much to be worth it. */
export function diffLines(a: string[], b: string[], maxEdits = 4000): DiffOp[] | null {
  // Common head and tail first: most versions differ in a few places.
  let start = 0
  while (start < a.length && start < b.length && a[start] === b[start]) start++
  let endA = a.length
  let endB = b.length
  while (endA > start && endB > start && a[endA - 1] === b[endB - 1]) {
    endA--
    endB--
  }
  const head = a.slice(0, start).map((text) => ({ type: 'same' as const, text }))
  const tail = a.slice(endA).map((text) => ({ type: 'same' as const, text }))
  const middle = myers(a.slice(start, endA), b.slice(start, endB), maxEdits)
  return middle && [...head, ...middle, ...tail]
}

function myers(a: string[], b: string[], maxEdits: number): DiffOp[] | null {
  const n = a.length
  const m = b.length
  if (!n) return b.map((text) => ({ type: 'add', text }))
  if (!m) return a.map((text) => ({ type: 'del', text }))
  const max = Math.min(n + m, maxEdits)
  const offset = max + 1
  const v = new Int32Array(2 * max + 3)
  const trace: Int32Array[] = []
  for (let d = 0; d <= max; d++) {
    trace.push(v.slice())
    for (let k = -d; k <= d; k += 2) {
      let x = k === -d || (k !== d && v[offset + k - 1] < v[offset + k + 1]) ? v[offset + k + 1] : v[offset + k - 1] + 1
      let y = x - k
      while (x < n && y < m && a[x] === b[y]) {
        x++
        y++
      }
      v[offset + k] = x
      if (x >= n && y >= m) return backtrack(trace, a, b, offset, d)
    }
  }
  return null
}

function backtrack(trace: Int32Array[], a: string[], b: string[], offset: number, d: number): DiffOp[] {
  const ops: DiffOp[] = []
  let x = a.length
  let y = b.length
  for (; d > 0; d--) {
    const v = trace[d]
    const k = x - y
    const down = k === -d || (k !== d && v[offset + k - 1] < v[offset + k + 1])
    const prevK = down ? k + 1 : k - 1
    const prevX = v[offset + prevK]
    const prevY = prevX - prevK
    while (x > prevX && y > prevY) {
      x--
      y--
      ops.push({ type: 'same', text: a[x] })
    }
    if (down) {
      y--
      ops.push({ type: 'add', text: b[y] })
    } else {
      x--
      ops.push({ type: 'del', text: a[x] })
    }
  }
  while (x > 0 && y > 0) {
    x--
    y--
    ops.push({ type: 'same', text: a[x] })
  }
  return ops.reverse()
}

/** Changed lines with `context` unchanged ones around them; longer unchanged runs become a count. */
export function hunks(ops: DiffOp[], context = 3): ({ type: 'skip'; count: number } | DiffOp)[] {
  const keep = new Uint8Array(ops.length)
  ops.forEach((op, i) => {
    if (op.type === 'same') return
    for (let j = Math.max(0, i - context); j <= Math.min(ops.length - 1, i + context); j++) keep[j] = 1
  })
  const out: ({ type: 'skip'; count: number } | DiffOp)[] = []
  let skipped = 0
  ops.forEach((op, i) => {
    if (keep[i]) {
      if (skipped) out.push({ type: 'skip', count: skipped })
      skipped = 0
      out.push(op)
    } else skipped++
  })
  if (skipped) out.push({ type: 'skip', count: skipped })
  return out
}

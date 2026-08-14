type DiffLineOp = {
  type: 'context' | 'add' | 'del'
  line: string
}

export type CreateUnifiedDiffInput = {
  oldText: string
  newText: string
  path?: string
  operation?: 'create' | 'update' | 'delete'
  contextLines?: number
}

const DEFAULT_CONTEXT_LINES = 3
const MAX_MYERS_LINES = 12_000

function splitLines(text: string): { lines: string[]; trailingNewline: boolean } {
  if (text.length === 0) return { lines: [], trailingNewline: true }
  const trailingNewline = text.endsWith('\n')
  const lines = text.split('\n')
  if (trailingNewline) lines.pop()
  return { lines, trailingNewline }
}

function shortestEditTrace(a: string[], b: string[]): Array<Record<number, number>> {
  const n = a.length
  const m = b.length
  const max = n + m
  const v: Record<number, number> = { 1: 0 }
  const trace: Array<Record<number, number>> = []

  for (let d = 0; d <= max; d += 1) {
    trace.push({ ...v })
    for (let k = -d; k <= d; k += 2) {
      let x: number
      if (k === -d || (k !== d && (v[k - 1] ?? -1) < (v[k + 1] ?? -1))) {
        x = v[k + 1] ?? 0
      } else {
        x = (v[k - 1] ?? 0) + 1
      }
      let y = x - k
      while (x < n && y < m && a[x] === b[y]) {
        x += 1
        y += 1
      }
      v[k] = x
      if (x >= n && y >= m) return trace
    }
  }

  return trace
}

function myersOps(a: string[], b: string[]): DiffLineOp[] {
  const trace = shortestEditTrace(a, b)
  const reversed: DiffLineOp[] = []
  let x = a.length
  let y = b.length

  for (let d = trace.length - 1; d >= 0; d -= 1) {
    const v = trace[d]
    const k = x - y
    const prevK = k === -d || (k !== d && (v[k - 1] ?? -1) < (v[k + 1] ?? -1)) ? k + 1 : k - 1
    const prevX = v[prevK] ?? 0
    const prevY = prevX - prevK

    while (x > prevX && y > prevY) {
      reversed.push({ type: 'context', line: a[x - 1] })
      x -= 1
      y -= 1
    }

    if (d > 0) {
      if (x === prevX) {
        reversed.push({ type: 'add', line: b[prevY] })
      } else {
        reversed.push({ type: 'del', line: a[prevX] })
      }
    }

    x = prevX
    y = prevY
  }

  return reversed.reverse()
}

function diffLineOps(a: string[], b: string[]): DiffLineOp[] {
  let prefix = 0
  while (prefix < a.length && prefix < b.length && a[prefix] === b[prefix]) prefix += 1

  let suffix = 0
  while (
    suffix < a.length - prefix &&
    suffix < b.length - prefix &&
    a[a.length - 1 - suffix] === b[b.length - 1 - suffix]
  ) {
    suffix += 1
  }

  const aMiddle = a.slice(prefix, a.length - suffix)
  const bMiddle = b.slice(prefix, b.length - suffix)

  const middle: DiffLineOp[] =
    aMiddle.length + bMiddle.length > MAX_MYERS_LINES
      ? [
          ...aMiddle.map((line): DiffLineOp => ({ type: 'del', line })),
          ...bMiddle.map((line): DiffLineOp => ({ type: 'add', line })),
        ]
      : myersOps(aMiddle, bMiddle)

  return [
    ...a.slice(0, prefix).map((line): DiffLineOp => ({ type: 'context', line })),
    ...middle,
    ...a.slice(a.length - suffix).map((line): DiffLineOp => ({ type: 'context', line })),
  ]
}

type HunkRange = { start: number; end: number }

function buildHunks(ops: DiffLineOp[], context: number): HunkRange[] {
  const hunks: HunkRange[] = []
  let i = 0

  while (i < ops.length) {
    while (i < ops.length && ops[i].type === 'context') i += 1
    if (i >= ops.length) break

    const start = Math.max(0, i - context)
    let end = i + 1
    let j = i + 1

    while (j < ops.length) {
      if (ops[j].type !== 'context') {
        end = j + 1
        j += 1
        continue
      }
      let k = j
      while (k < ops.length && ops[k].type === 'context') k += 1
      const runLength = k - j
      if (k >= ops.length) {
        end = j + Math.min(runLength, context)
      } else if (runLength <= 2 * context) {
        j = k
        continue
      } else {
        end = j + context
      }
      j = k
      break
    }

    hunks.push({ start, end })
    i = Math.max(j, end)
  }

  return hunks
}

function formatRange(start: number, count: number): string {
  return `${start},${count}`
}

export function createUnifiedDiff({
  oldText,
  newText,
  path = 'file',
  operation = 'update',
  contextLines = DEFAULT_CONTEXT_LINES,
}: CreateUnifiedDiffInput): string {
  const oldSide = splitLines(oldText)
  const newSide = splitLines(newText)
  let ops = diffLineOps(oldSide.lines, newSide.lines)

  if (ops.every((op) => op.type === 'context')) {
    if (oldSide.trailingNewline === newSide.trailingNewline) return ''
    const last = ops.length - 1
    ops = [
      ...ops.slice(0, last),
      { type: 'del', line: oldSide.lines[last] },
      { type: 'add', line: newSide.lines[last] },
    ]
  }

  const oldHeader = operation === 'create' ? '/dev/null' : `a/${path}`
  const newHeader = operation === 'delete' ? '/dev/null' : `b/${path}`
  const output: string[] = [`--- ${oldHeader}`, `+++ ${newHeader}`]

  const oldBefore: number[] = new Array(ops.length)
  const newBefore: number[] = new Array(ops.length)
  let oldCursor = 0
  let newCursor = 0
  for (let i = 0; i < ops.length; i += 1) {
    oldBefore[i] = oldCursor
    newBefore[i] = newCursor
    if (ops[i].type !== 'add') oldCursor += 1
    if (ops[i].type !== 'del') newCursor += 1
  }

  const lastOldIndex = oldSide.lines.length - 1
  const lastNewIndex = newSide.lines.length - 1

  for (const { start, end } of buildHunks(ops, contextLines)) {
    const hunk = ops.slice(start, end)
    const oldCount = hunk.filter((op) => op.type !== 'add').length
    const newCount = hunk.filter((op) => op.type !== 'del').length
    const oldStart = oldCount > 0 ? oldBefore[start] + 1 : oldBefore[start]
    const newStart = newCount > 0 ? newBefore[start] + 1 : newBefore[start]

    output.push(`@@ -${formatRange(oldStart, oldCount)} +${formatRange(newStart, newCount)} @@`)

    let oldIndex = oldBefore[start]
    let newIndex = newBefore[start]

    for (const op of hunk) {
      if (op.type === 'context') {
        output.push(` ${op.line}`)
        const isLastOld = oldIndex === lastOldIndex
        const isLastNew = newIndex === lastNewIndex
        if ((isLastOld && !oldSide.trailingNewline) || (isLastNew && !newSide.trailingNewline)) {
          output.push('\\ No newline at end of file')
        }
        oldIndex += 1
        newIndex += 1
      } else if (op.type === 'del') {
        output.push(`-${op.line}`)
        if (oldIndex === lastOldIndex && !oldSide.trailingNewline) {
          output.push('\\ No newline at end of file')
        }
        oldIndex += 1
      } else {
        output.push(`+${op.line}`)
        if (newIndex === lastNewIndex && !newSide.trailingNewline) {
          output.push('\\ No newline at end of file')
        }
        newIndex += 1
      }
    }
  }

  return output.join('\n')
}

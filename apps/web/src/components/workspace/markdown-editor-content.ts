// TipTap uses standalone `&nbsp;` paragraphs to preserve visual blank lines.
const BLANK_LINE_MARKER = "&nbsp;"
const FENCE_DELIMITER_PATTERN = /^ {0,3}(`{3,}|~{3,})/u

type FenceState = {
  marker: "`" | "~"
  length: number
}

function normalizeLineEndings(value: string): string {
  return value.replace(/\r\n?/gu, "\n")
}

function trimTrailingNewlines(value: string): string {
  return value.replace(/\n+$/u, "")
}

function updateFenceState(line: string, current: FenceState | null): FenceState | null {
  const match = line.match(FENCE_DELIMITER_PATTERN)
  if (!match) return current

  const delimiter = match[1]
  const marker = delimiter[0] as FenceState["marker"]

  if (current) {
    if (marker === current.marker && delimiter.length >= current.length) {
      return null
    }

    return current
  }

  return {
    marker,
    length: delimiter.length,
  }
}

function isFenceDelimiterLine(line: string): boolean {
  return FENCE_DELIMITER_PATTERN.test(line)
}

function encodeBlankLineRun(
  runLength: number,
  position: "leading" | "middle" | "trailing"
): string[] {
  if (position === "leading") {
    const next: string[] = []

    for (let index = 0; index < runLength; index += 1) {
      next.push(BLANK_LINE_MARKER, "")
    }

    return next
  }

  if (position === "middle") {
    const next = [""]

    for (let index = 1; index < runLength; index += 1) {
      next.push(BLANK_LINE_MARKER, "")
    }

    return next
  }

  if (runLength === 1) {
    return [""]
  }

  const next = [""]

  for (let index = 1; index < runLength; index += 1) {
    if (index > 1) {
      next.push("")
    }

    next.push(BLANK_LINE_MARKER)
  }

  return next
}

export function encodeMarkdownForEditor(value: string): string {
  const normalized = normalizeLineEndings(value)
  if (normalized.length === 0) return normalized
  if (!normalized.split("\n").some((line) => line.length > 0)) return normalized

  const lines = normalized.split("\n")
  const next: string[] = []
  let fenceState: FenceState | null = null
  let seenContent = false
  let index = 0

  while (index < lines.length) {
    const line = lines[index]

    if (fenceState !== null || isFenceDelimiterLine(line)) {
      next.push(line)
      if (line.length > 0) {
        seenContent = true
      }

      fenceState = updateFenceState(line, fenceState)
      index += 1
      continue
    }

    if (line.length > 0) {
      next.push(line)
      seenContent = true
      index += 1
      continue
    }

    let runEnd = index
    while (runEnd < lines.length && lines[runEnd].length === 0) {
      runEnd += 1
    }

    const hasContentAfter = lines.slice(runEnd).some((candidate) => candidate.length > 0)
    const position = seenContent
      ? hasContentAfter
        ? "middle"
        : "trailing"
      : "leading"

    next.push(...encodeBlankLineRun(runEnd - index, position))
    index = runEnd
  }

  return next.join("\n")
}

export function normalizeMarkdownForKb(value: string): string {
  const lines = normalizeLineEndings(value).split("\n")
  const next: string[] = []
  let fenceState: FenceState | null = null
  let seenContent = false

  let index = 0

  while (index < lines.length) {
    const line = lines[index]

    if (fenceState !== null || isFenceDelimiterLine(line)) {
      next.push(line)
      if (line.length > 0) {
        seenContent = true
      }

      fenceState = updateFenceState(line, fenceState)
      index += 1
      continue
    }

    if (line.length > 0 && line !== BLANK_LINE_MARKER) {
      next.push(line.replaceAll("\u00A0", " ").replaceAll(BLANK_LINE_MARKER, " "))
      seenContent = true
      index += 1
      continue
    }

    let runEnd = index
    let markerCount = 0

    while (
      runEnd < lines.length &&
      (lines[runEnd].length === 0 || lines[runEnd] === BLANK_LINE_MARKER)
    ) {
      if (lines[runEnd] === BLANK_LINE_MARKER) {
        markerCount += 1
      }

      runEnd += 1
    }

    if (markerCount === 0) {
      next.push(...lines.slice(index, runEnd))
      index = runEnd
      continue
    }

    const blankLineCount = seenContent ? markerCount + 1 : markerCount
    next.push(...Array.from({ length: blankLineCount }, () => ""))
    index = runEnd
  }

  return next.join("\n")
}

export function isEquivalentMarkdown(left: string, right: string): boolean {
  if (left === right) return true

  const normalizedLeft = trimTrailingNewlines(
    normalizeLineEndings(normalizeMarkdownForKb(left))
  )
  const normalizedRight = trimTrailingNewlines(
    normalizeLineEndings(normalizeMarkdownForKb(right))
  )

  return normalizedLeft === normalizedRight
}

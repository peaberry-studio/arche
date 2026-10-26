export type KbSection = {
  path: string
  heading: string
  line: number
  text: string
}

const HEADING_PATTERN = /^(#{1,3})\s+(.+?)\s*#*\s*$/
const FENCE_PATTERN = /^\s*(```|~~~)/
const MAX_SECTION_CHARS = 500
const MIN_TOKEN_LENGTH = 2

export function splitArticleIntoSections(path: string, content: string): KbSection[] {
  const sections: KbSection[] = []
  const trail: string[] = []
  let heading = ''
  let line = 1
  let body: string[] = []
  let inFence = false

  const flush = () => {
    for (const text of splitLongText(body.join('\n').trim())) {
      sections.push({ path, heading, line, text })
    }
  }

  content.split('\n').forEach((rawLine, index) => {
    if (FENCE_PATTERN.test(rawLine)) inFence = !inFence
    const match = inFence ? null : HEADING_PATTERN.exec(rawLine)

    if (!match) {
      body.push(rawLine)
      return
    }

    flush()
    const level = match[1].length
    trail.length = level - 1
    trail[level - 1] = match[2]
    heading = trail.filter(Boolean).join(' › ')
    line = index + 1
    body = []
  })

  flush()
  return sections
}

function splitLongText(text: string): string[] {
  if (!text) return []
  if (text.length <= MAX_SECTION_CHARS) return [text]

  const chunks: string[] = []
  let current = ''
  for (const line of text.split('\n')) {
    const candidate = current ? `${current}\n${line}` : line
    if (current && candidate.length > MAX_SECTION_CHARS) {
      chunks.push(current.trim())
      current = line
    } else {
      current = candidate
    }
  }
  if (current.trim()) chunks.push(current.trim())
  return chunks
}

export function tokenize(text: string): string[] {
  return text
    .normalize('NFKD')
    .replace(/\p{M}/gu, '')
    .toLowerCase()
    .split(/[^\p{L}\p{N}]+/u)
    .filter((token) => token.length >= MIN_TOKEN_LENGTH)
}

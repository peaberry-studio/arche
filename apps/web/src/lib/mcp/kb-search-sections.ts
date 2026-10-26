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
// Accent-folded Spanish and English function words: they occur in nearly every
// section, so matching them makes unrelated queries return every article.
const STOP_WORDS = new Set([
  'al', 'como', 'con', 'cual', 'cuando', 'de', 'del', 'desde', 'donde', 'el', 'en', 'entre', 'es', 'esa', 'ese', 'eso',
  'esta', 'este', 'esto', 'fue', 'hay', 'la', 'las', 'le', 'les', 'lo', 'los', 'mas', 'me', 'mi', 'muy', 'no', 'nos',
  'para', 'pero', 'por', 'que', 'quien', 'se', 'ser', 'si', 'sin', 'sobre', 'son', 'su', 'sus', 'te', 'tu', 'un', 'una',
  'unas', 'unos', 'ya',
  'an', 'and', 'are', 'as', 'at', 'be', 'but', 'by', 'can', 'do', 'does', 'each', 'for', 'from', 'has', 'have', 'how',
  'if', 'in', 'into', 'is', 'it', 'its', 'of', 'on', 'or', 'our', 'so', 'than', 'that', 'the', 'their', 'them', 'then',
  'there', 'these', 'they', 'this', 'those', 'to', 'was', 'we', 'what', 'when', 'where', 'which', 'who', 'will', 'with',
  'you', 'your',
])

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
    .filter((token) => token.length >= MIN_TOKEN_LENGTH && !STOP_WORDS.has(token))
}

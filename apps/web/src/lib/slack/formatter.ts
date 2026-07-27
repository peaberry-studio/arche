const MAX_SLACK_MESSAGE_LENGTH = 3_500
const PLACEHOLDER_PATTERN = /\uE000(\d+)\uE001/g
const SAFE_LINK_PROTOCOLS = new Set(['http:', 'https:', 'mailto:'])

export function formatSlackMessages(text: string, authorizedMentions: readonly string[] = []): string[] {
  const normalized = text
    .replace(/\r\n?/g, '\n')
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, '')
  const mrkdwn = formatBlocks(normalized, new Set(authorizedMentions))

  return splitSlackMessage(mrkdwn)
}

function formatBlocks(text: string, authorizedMentions: ReadonlySet<string>): string {
  const lines = text.split('\n')
  const output: string[] = []
  let codeFence: { marker: string; lines: string[] } | null = null

  for (const line of lines) {
    const fence = line.match(/^ {0,3}(`{3,}|~{3,})/)
    if (codeFence) {
      if (fence?.[1]?.startsWith(codeFence.marker[0])) {
        output.push(`\`\`\`\n${codeFence.lines.join('\n')}\n\`\`\``)
        codeFence = null
      } else {
        codeFence.lines.push(line)
      }
      continue
    }

    if (fence?.[1]) {
      codeFence = { marker: fence[1], lines: [] }
      continue
    }

    output.push(formatLine(line, authorizedMentions))
  }

  if (codeFence) {
    output.push(`\`\`\`\n${codeFence.lines.join('\n')}\n\`\`\``)
  }

  return output.join('\n').trim()
}

function formatLine(line: string, authorizedMentions: ReadonlySet<string>): string {
  const heading = line.match(/^ {0,3}#{1,6}\s+(.+)$/)
  if (heading?.[1]) {
    return `*${formatInline(heading[1], authorizedMentions)}*`
  }

  const quote = line.match(/^ {0,3}>\s?(.*)$/)
  if (quote) {
    return `> ${formatInline(quote[1] ?? '', authorizedMentions)}`
  }

  const unorderedItem = line.match(/^(\s*)[-+*]\s+(.+)$/)
  if (unorderedItem) {
    return `${unorderedItem[1]}• ${formatInline(unorderedItem[2] ?? '', authorizedMentions)}`
  }

  return formatInline(line, authorizedMentions)
}

function formatInline(text: string, authorizedMentions: ReadonlySet<string>): string {
  const protectedValues: string[] = []
  const protect = (value: string): string => {
    protectedValues.push(value)
    return `\uE000${protectedValues.length - 1}\uE001`
  }

  let formatted = text.replace(/<@[A-Z0-9]+>/gi, (mention) => (
    authorizedMentions.has(mention) ? protect(mention) : mention
  ))

  formatted = protectCodeSpans(formatted, protect)
  formatted = formatted.replace(/\[([^\]\n]+)]\(([^\s)]+)(?:\s+['"][^'"]*['"])?\)/g, (match, label: string, url: string) => {
    const slackLink = formatLink(label, url)
    return slackLink ? protect(slackLink) : match
  })

  formatted = escapeSlackText(formatted)
    .replace(/(^|[^*])\*([^*\n]+)\*(?!\*)/g, '$1_$2_')
    .replace(/\*\*([^*\n]+)\*\*/g, '*$1*')
    .replace(/__([^_\n]+)__/g, '*$1*')
    .replace(/~~([^~\n]+)~~/g, '~$1~')

  return formatted.replace(PLACEHOLDER_PATTERN, (_, index: string) => protectedValues[Number(index)] ?? '')
}

function protectCodeSpans(text: string, protect: (value: string) => string): string {
  return text.replace(/(`+)([^\n]*?)\1/g, (_, delimiter: string, value: string) => {
    const content = value.startsWith(' ') && value.endsWith(' ') && value.trim()
      ? value.slice(1, -1)
      : value
    return protect(`\`${content}\``)
  })
}

function formatLink(label: string, rawUrl: string): string | null {
  try {
    const url = new URL(rawUrl)
    if (!SAFE_LINK_PROTOCOLS.has(url.protocol)) {
      return null
    }

    const safeUrl = rawUrl.replace(/&/g, '&amp;').replace(/>/g, '%3E').replace(/\|/g, '%7C')
    const safeLabel = escapeSlackText(label).replace(/\|/g, '¦')
    return `<${safeUrl}|${safeLabel}>`
  } catch {
    return null
  }
}

function escapeSlackText(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
}

function splitSlackMessage(text: string): string[] {
  if (!text) {
    return ['']
  }
  if (visibleLength(text) <= MAX_SLACK_MESSAGE_LENGTH) {
    return [text]
  }

  const chunks: string[] = []
  let current = ''
  for (const paragraph of text.split(/\n{2,}/)) {
    const candidate = current ? `${current}\n\n${paragraph}` : paragraph
    if (visibleLength(candidate) <= MAX_SLACK_MESSAGE_LENGTH) {
      current = candidate
      continue
    }

    if (current) {
      chunks.push(current)
      current = ''
    }

    const paragraphChunks = splitLongParagraph(paragraph)
    chunks.push(...paragraphChunks.slice(0, -1))
    current = paragraphChunks.at(-1) ?? ''
  }

  if (current || chunks.length === 0) {
    chunks.push(current)
  }
  return chunks
}

function splitLongParagraph(paragraph: string): string[] {
  const fencedCode = paragraph.match(/^```\n([\s\S]*)\n```$/)
  if (fencedCode) {
    return splitByVisibleLength(fencedCode[1] ?? '', MAX_SLACK_MESSAGE_LENGTH - 8)
      .map((part) => `\`\`\`\n${part}\n\`\`\``)
  }

  return splitByVisibleLength(paragraph, MAX_SLACK_MESSAGE_LENGTH)
}

function splitByVisibleLength(text: string, limit: number): string[] {
  const chunks: string[] = []
  let current = ''
  let currentLength = 0
  const tokens = text.match(/<[^>\n]+>|\s+|[^\s<]+/gu) ?? []

  for (const token of tokens) {
    const tokenLength = visibleLength(token)
    if (tokenLength <= limit) {
      if (current && currentLength + tokenLength > limit) {
        chunks.push(current.trimEnd())
        current = ''
        currentLength = 0
      }
      const normalizedToken = current ? token : token.trimStart()
      current += normalizedToken
      currentLength += visibleLength(normalizedToken)
      continue
    }

    for (const character of Array.from(token)) {
      if (currentLength === limit) {
        chunks.push(current.trimEnd())
        current = ''
        currentLength = 0
      }
      current += character
      currentLength += 1
    }
  }

  if (current || chunks.length === 0) {
    chunks.push(current)
  }
  return chunks
}

function visibleLength(text: string): number {
  const visible = text
    .replace(/<[^|>]+\|([^>]*)>/g, '$1')
    .replace(/<@[A-Z0-9]+>/gi, '@')
    .replace(/&(amp|lt|gt);/g, 'x')
  return Array.from(visible).length
}

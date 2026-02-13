export type SseParseState = {
  buffer: string
  eventType: string
  dataLines: string[]
}

export type ParsedSseEvent = {
  event: string
  data: string
}

export const INITIAL_SSE_PARSE_STATE: SseParseState = {
  buffer: '',
  eventType: '',
  dataLines: [],
}

export function parseSseChunk(
  state: SseParseState,
  chunk: string,
): { state: SseParseState; events: ParsedSseEvent[] } {
  const next = `${state.buffer}${chunk}`
  const lines = next.split('\n')
  const buffer = lines.pop() ?? ''

  let eventType = state.eventType
  let dataLines = [...state.dataLines]
  const events: ParsedSseEvent[] = []

  for (const rawLine of lines) {
    const line = rawLine.endsWith('\r') ? rawLine.slice(0, -1) : rawLine

    if (line.startsWith('event:')) {
      eventType = line.slice(6).trim()
      continue
    }

    if (line.startsWith('data:')) {
      dataLines.push(line.slice(5).trimStart())
      continue
    }

    if (line === '') {
      const data = dataLines.join('\n')
      if (data.length > 0) {
        events.push({ event: eventType || 'message', data })
      }

      eventType = ''
      dataLines = []
    }
  }

  return {
    state: {
      buffer,
      eventType,
      dataLines,
    },
    events,
  }
}

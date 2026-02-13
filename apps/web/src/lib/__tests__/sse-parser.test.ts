import { describe, expect, it } from 'vitest'

import { INITIAL_SSE_PARSE_STATE, parseSseChunk } from '@/lib/sse-parser'

describe('parseSseChunk', () => {
  it('parses single event payload', () => {
    const input = 'event: message\ndata: {"type":"ok"}\n\n'
    const parsed = parseSseChunk(INITIAL_SSE_PARSE_STATE, input)

    expect(parsed.events).toEqual([{ event: 'message', data: '{"type":"ok"}' }])
  })

  it('joins multi-line data payloads', () => {
    const input = [
      'event: message',
      'data: {"type":"message.part.updated","properties":{"part":{"type":"text"},',
      'data: "delta":{"text":"hello"}}}',
      '',
      '',
    ].join('\n')

    const parsed = parseSseChunk(INITIAL_SSE_PARSE_STATE, input)

    expect(parsed.events).toHaveLength(1)
    expect(parsed.events[0]?.data).toContain('"delta":{"text":"hello"}}}')
  })

  it('handles chunk boundaries and keeps state', () => {
    const first = parseSseChunk(
      INITIAL_SSE_PARSE_STATE,
      'event: message\ndata: {"type":"partial"',
    )
    expect(first.events).toEqual([])

    const second = parseSseChunk(first.state, '}\n\n')
    expect(second.events).toEqual([{ event: 'message', data: '{"type":"partial"}' }])
  })

  it('supports CRLF lines', () => {
    const input = 'event: message\r\ndata: {"type":"crlf"}\r\n\r\n'
    const parsed = parseSseChunk(INITIAL_SSE_PARSE_STATE, input)

    expect(parsed.events).toEqual([{ event: 'message', data: '{"type":"crlf"}' }])
  })
})

import { describe, expect, it } from 'vitest'

import {
  clampSessionHistoryBounds,
  getMessageRole,
  getMessageText,
  getSessionId,
  getSessionTitle,
  isRecord,
} from '@/lib/learning/session-history'

describe('session history helpers', () => {
  it('detects plain records', () => {
    expect(isRecord({ id: 'session-1' })).toBe(true)
    expect(isRecord(null)).toBe(false)
    expect(isRecord([])).toBe(false)
  })

  it('extracts session fields with defaults', () => {
    expect(getSessionTitle({ title: 'Planning' })).toBe('Planning')
    expect(getSessionTitle({ title: '   ' })).toBe('Untitled')
    expect(getSessionId({ id: 'session-1' })).toBe('session-1')
    expect(getSessionId({ id: 1 })).toBeNull()
  })

  it('extracts message role and text from OpenCode-like parts', () => {
    expect(getMessageRole({ info: { role: 'assistant' } })).toBe('assistant')
    expect(getMessageRole({ info: {} })).toBe('unknown')
    expect(getMessageText({
      parts: [
        { id: 'part-1', text: 'hello', type: 'text' },
        { content: 'world', id: 'part-2' },
        { id: 'part-3', text: 'world', type: 'text' },
      ],
    })).toBe('hello\nworld')
    expect(getMessageText({ parts: [] })).toBe('')
  })

  it('clamps query bounds', () => {
    expect(clampSessionHistoryBounds(null)).toEqual({ limit: 20, maxMessages: 20 })
    expect(clampSessionHistoryBounds({ limit: 0, maxMessagesPerSession: 500 })).toEqual({ limit: 1, maxMessages: 100 })
    expect(clampSessionHistoryBounds({ limit: 4.8, maxMessagesPerSession: 3.2 })).toEqual({ limit: 4, maxMessages: 3 })
  })
})

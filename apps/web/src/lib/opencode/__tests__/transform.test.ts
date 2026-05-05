import { describe, expect, it, vi } from 'vitest'

import { transformParts, extractTextContent } from '@/lib/opencode/transform'

describe('transformParts', () => {
  it('normalizes bigint values before returning UI parts', () => {
    const parts = transformParts([
      {
        type: 'tool',
        callID: 'tool-1',
        tool: 'query_db',
        state: {
          status: 'running',
          input: {
            count: BigInt(2),
            nested: {
              total: BigInt(5),
            },
          },
        },
      },
      {
        type: 'mystery',
        id: 'm-1',
        payload: {
          id: BigInt(9),
        },
      },
    ])

    expect(parts).toEqual([
      {
        type: 'tool',
        id: 'tool-1',
        name: 'query_db',
        state: {
          status: 'running',
          input: {
            count: '2',
            nested: {
              total: '5',
            },
          },
        },
      },
      {
        type: 'unknown',
        originalType: 'mystery',
        data: {
          type: 'mystery',
          id: 'm-1',
          payload: {
            id: '9',
          },
        },
      },
    ])
  })

  it('extracts attachment paths from local desktop file URLs', () => {
    const parts = transformParts([
      {
        type: 'file',
        id: 'file-1',
        filename: 'photo.jpg',
        url: 'file:///Users/alice/Arche/workspace/.arche/attachments/photo.jpg',
      },
    ])

    expect(parts).toEqual([
      {
        type: 'file',
        id: 'file-1',
        path: '.arche/attachments/photo.jpg',
        filename: 'photo.jpg',
        url: 'file:///Users/alice/Arche/workspace/.arche/attachments/photo.jpg',
      },
    ])
  })

  it('transforms text parts', () => {
    const result = transformParts([{ type: 'text', id: 't1', text: 'hello' }])
    expect(result).toEqual([{ type: 'text', id: 't1', text: 'hello' }])
  })

  it('filters empty text parts', () => {
    expect(transformParts([{ type: 'text', id: 't1', text: '' }])).toEqual([])
    expect(transformParts([{ type: 'text', id: 't2', text: '   ' }])).toEqual([])
  })

  it('transforms reasoning parts', () => {
    const result = transformParts([{ type: 'reasoning', id: 'r1', text: 'thinking' }])
    expect(result).toEqual([{ type: 'reasoning', id: 'r1', text: 'thinking' }])
  })

  it('filters empty reasoning parts', () => {
    expect(transformParts([{ type: 'reasoning', id: 'r1', text: '' }])).toEqual([])
  })

  it('hides snapshot and compaction parts', () => {
    const result = transformParts([
      { type: 'snapshot', id: 's1' },
      { type: 'compaction', id: 'c1' },
      { type: 'text', id: 't1', text: 'visible' },
    ])
    expect(result).toHaveLength(1)
    expect(result[0].type).toBe('text')
  })

  it('transforms tool with completed state', () => {
    const result = transformParts([{
      type: 'tool',
      callID: 'call1',
      tool: 'read',
      state: { status: 'completed', input: { path: 'f.ts' }, output: 'content', title: 'Read file' },
    }])
    expect(result[0]).toEqual({
      type: 'tool',
      id: 'call1',
      name: 'read',
      state: { status: 'completed', input: { path: 'f.ts' }, output: 'content', title: 'Read file' },
    })
  })

  it('transforms tool with error state', () => {
    const result = transformParts([{
      type: 'tool',
      id: 'tool1',
      tool: 'bash',
      state: { status: 'error', input: {}, error: 'command failed' },
    }])
    expect(result[0]).toMatchObject({
      type: 'tool',
      name: 'bash',
      state: { status: 'error', error: 'command failed' },
    })
  })

  it('transforms tool with running state', () => {
    const result = transformParts([{
      type: 'tool',
      id: 'tool1',
      tool: 'write',
      state: { status: 'running', input: {}, title: 'Writing...' },
    }])
    expect(result[0]).toMatchObject({
      state: { status: 'running', title: 'Writing...' },
    })
  })

  it('preserves tool metadata for subagent session links', () => {
    const result = transformParts([{
      type: 'tool',
      callID: 'call1',
      tool: 'task',
      state: {
        status: 'running',
        input: { subagent_type: 'reviewer' },
        metadata: {
          count: BigInt(2),
          sessionId: 'sub-1',
        },
      },
    }])

    expect(result[0]).toEqual({
      type: 'tool',
      id: 'call1',
      name: 'task',
      state: {
        status: 'running',
        input: { subagent_type: 'reviewer' },
        metadata: {
          count: '2',
          sessionId: 'sub-1',
        },
      },
    })
  })

  it('transforms tool with pending state', () => {
    const result = transformParts([{
      type: 'tool',
      id: 'tool1',
      tool: 'edit',
      state: { status: 'pending', input: {} },
    }])
    expect(result[0]).toMatchObject({ state: { status: 'pending' } })
  })

  it('defaults to pending for unknown tool status', () => {
    const result = transformParts([{
      type: 'tool',
      id: 'tool1',
      tool: 'edit',
      state: { status: 'unknown_status', input: {} },
    }])
    expect(result[0]).toMatchObject({ state: { status: 'pending' } })
  })

  it('transforms file parts with workspace path from URL', () => {
    const result = transformParts([{
      type: 'file',
      id: 'f1',
      url: 'file:///workspace/src/app.ts',
    }])
    expect(result[0]).toMatchObject({ path: 'src/app.ts' })
  })

  it('transforms file parts with source path', () => {
    const result = transformParts([{
      type: 'file',
      id: 'f1',
      source: { path: 'readme.md' },
    }])
    expect(result[0]).toMatchObject({ path: 'readme.md' })
  })

  it('transforms image parts', () => {
    const result = transformParts([{ type: 'image', id: 'i1', url: 'https://example.com/img.png' }])
    expect(result).toEqual([{ type: 'image', id: 'i1', url: 'https://example.com/img.png' }])
  })

  it('transforms step-start parts', () => {
    const result = transformParts([{ type: 'step-start', id: 'ss1', snapshot: 'snap1' }])
    expect(result).toEqual([{ type: 'step-start', id: 'ss1', snapshot: 'snap1' }])
  })

  it('transforms step-finish parts', () => {
    const result = transformParts([{
      type: 'step-finish',
      id: 'sf1',
      reason: 'end_turn',
      cost: 0.05,
      tokens: { input: 100, output: 50 },
    }])
    expect(result).toEqual([{
      type: 'step-finish',
      id: 'sf1',
      reason: 'end_turn',
      cost: 0.05,
      tokens: { input: 100, output: 50 },
    }])
  })

  it('transforms patch parts', () => {
    const result = transformParts([{ type: 'patch', id: 'p1', files: ['a.ts', 'b.ts'] }])
    expect(result).toEqual([{ type: 'patch', id: 'p1', files: ['a.ts', 'b.ts'] }])
  })

  it('handles patch with non-array files', () => {
    const result = transformParts([{ type: 'patch', id: 'p1', files: 'not-array' }])
    expect(result[0]).toMatchObject({ files: [] })
  })

  it('transforms agent parts', () => {
    const result = transformParts([{ type: 'agent', id: 'a1', name: 'coder' }])
    expect(result).toEqual([{ type: 'agent', id: 'a1', name: 'coder' }])
  })

  it('transforms subtask parts', () => {
    const result = transformParts([{
      type: 'subtask',
      id: 'st1',
      prompt: 'fix bug',
      description: 'Fix the bug',
      agent: 'debugger',
    }])
    expect(result).toEqual([{
      type: 'subtask',
      id: 'st1',
      prompt: 'fix bug',
      description: 'Fix the bug',
      agent: 'debugger',
    }])
  })

  it('transforms retry parts with data.message', () => {
    const result = transformParts([{
      type: 'retry',
      id: 'rt1',
      attempt: 2,
      error: { data: { message: 'rate limited' } },
    }])
    expect(result[0]).toMatchObject({ type: 'retry', attempt: 2, error: 'rate limited' })
  })

  it('transforms retry parts with fallback error.message', () => {
    const result = transformParts([{
      type: 'retry',
      id: 'rt1',
      attempt: 1,
      error: { message: 'fallback' },
    }])
    expect(result[0]).toMatchObject({ error: 'fallback' })
  })

  it('generates id when missing', () => {
    const result = transformParts([{ type: 'text', text: 'no id' }])
    expect(result[0].id).toMatch(/^part-\d+$/)
  })

  it('handles empty array', () => {
    expect(transformParts([])).toEqual([])
  })

  it('normalizes Date objects in tool input', () => {
    const date = new Date('2026-01-01T00:00:00Z')
    const result = transformParts([{
      type: 'tool',
      id: 't1',
      tool: 'test',
      state: { status: 'completed', input: { date }, output: '', title: 'test' },
    }])
    const state = (result[0] as { state: { input: Record<string, unknown> } }).state
    expect(state.input.date).toBe('2026-01-01T00:00:00.000Z')
  })

  it('normalizes nested arrays in tool input', () => {
    const result = transformParts([{
      type: 'tool',
      id: 't1',
      tool: 'test',
      state: { status: 'completed', input: { items: [BigInt(1), BigInt(2)] }, output: '', title: 'test' },
    }])
    const state = (result[0] as { state: { input: Record<string, unknown> } }).state
    expect(state.input.items).toEqual(['1', '2'])
  })

  it('handles step-start without snapshot', () => {
    const result = transformParts([{ type: 'step-start', id: 'ss1' }])
    expect(result[0]).toMatchObject({ type: 'step-start', snapshot: undefined })
  })

  it('handles step-finish with missing token fields', () => {
    const result = transformParts([{ type: 'step-finish', id: 'sf1' }])
    expect(result[0]).toMatchObject({
      type: 'step-finish',
      reason: '',
      cost: 0,
      tokens: { input: 0, output: 0 },
    })
  })

  it('wraps non-object normalized data in { value: ... }', () => {
    const spy = vi.spyOn(console, 'log').mockImplementation(() => {})
    const result = transformParts([{ type: 'custom', id: 'c1' }])
    expect(result[0]).toMatchObject({ type: 'unknown', originalType: 'custom' })
    spy.mockRestore()
  })

  it('handles tool without state', () => {
    const result = transformParts([{
      type: 'tool',
      id: 't1',
      tool: 'read',
    }])
    expect(result[0]).toMatchObject({ state: { status: 'pending' } })
  })

  it('handles file without path or url', () => {
    const result = transformParts([{ type: 'file', id: 'f1' }])
    expect(result[0]).toMatchObject({ path: '' })
  })

  it('handles running tool without title', () => {
    const result = transformParts([{
      type: 'tool',
      id: 't1',
      tool: 'write',
      state: { status: 'running', input: {} },
    }])
    expect((result[0] as { state: { title?: string } }).state.title).toBeUndefined()
  })
})

describe('extractTextContent', () => {
  it('extracts text from text parts', () => {
    const result = extractTextContent([
      { type: 'text', id: 't1', text: 'hello' },
      { type: 'text', id: 't2', text: 'world' },
    ])
    expect(result).toBe('hello\nworld')
  })

  it('extracts text from reasoning parts', () => {
    expect(extractTextContent([{ type: 'reasoning', id: 'r1', text: 'thinking' }])).toBe('thinking')
  })

  it('ignores non-text parts', () => {
    const result = extractTextContent([
      { type: 'text', id: 't1', text: 'hello' },
      { type: 'tool', id: 'tool1', name: 'read', state: { status: 'pending', input: {} } },
      { type: 'image', id: 'i1', url: 'http://example.com/img.png' },
    ])
    expect(result).toBe('hello')
  })

  it('returns empty string for empty array', () => {
    expect(extractTextContent([])).toBe('')
  })

  it('combines text and reasoning parts', () => {
    const result = extractTextContent([
      { type: 'text', id: 't1', text: 'answer' },
      { type: 'reasoning', id: 'r1', text: 'because' },
    ])
    expect(result).toBe('answer\nbecause')
  })
})

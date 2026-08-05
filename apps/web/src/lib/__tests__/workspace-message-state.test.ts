import { describe, expect, it } from 'vitest'

import type { MessagePart } from '@/lib/opencode/types'
import { deriveWorkspaceMessageRuntimeState } from '@/lib/workspace-message-state'

describe('deriveWorkspaceMessageRuntimeState', () => {
  it('marks completed empty assistant responses as incomplete', () => {
    const result = deriveWorkspaceMessageRuntimeState({
      role: 'assistant',
      completedAt: Date.now(),
      parts: [],
    })

    expect(result).toEqual({
      pending: false,
      statusInfo: { status: 'error', detail: 'stream_incomplete' },
    })
  })

  it('marks empty assistant response as thinking pending', () => {
    const result = deriveWorkspaceMessageRuntimeState({
      role: 'assistant',
      parts: [],
    })

    expect(result).toEqual({ pending: true, statusInfo: { status: 'thinking' } })
  })

  it('marks empty assistant response as incomplete when session is idle', () => {
    const result = deriveWorkspaceMessageRuntimeState({
      role: 'assistant',
      parts: [],
      sessionStatus: 'idle',
    })

    expect(result).toEqual({
      pending: false,
      statusInfo: { status: 'error', detail: 'stream_incomplete' },
    })
  })

  it('keeps tool-running assistants pending', () => {
    const parts: MessagePart[] = [
      {
        type: 'tool',
        id: 'tool-1',
        name: 'read_file',
        state: { status: 'running', input: {}, title: 'reading' },
      },
    ]

    const result = deriveWorkspaceMessageRuntimeState({
      role: 'assistant',
      parts,
    })

    expect(result.pending).toBe(true)
    expect(result.statusInfo?.status).toBe('tool-calling')
    expect(result.statusInfo?.toolName).toBe('read_file')
  })

  it('keeps pending permission requests pending', () => {
    const parts: MessagePart[] = [
      {
        type: 'permission',
        id: 'permission:permission-1',
        permissionId: 'permission-1',
        sessionId: 'session-1',
        title: 'Deploy application',
        pattern: '*',
        state: 'pending',
        metadata: { tool: 'deploy' },
      },
    ]

    const result = deriveWorkspaceMessageRuntimeState({
      role: 'assistant',
      parts,
    })

    expect(result).toEqual({
      pending: true,
      statusInfo: {
        status: 'tool-calling',
        toolName: 'deploy',
        detail: 'permission_required',
      },
    })
  })

  it('does not keep plain text assistants pending without completedAt', () => {
    const parts: MessagePart[] = [{ type: 'text', text: 'done' }]

    const result = deriveWorkspaceMessageRuntimeState({
      role: 'assistant',
      parts,
    })

    expect(result).toEqual({ pending: false })
  })

  it('preserves tool errors even when the message is completed', () => {
    const parts: MessagePart[] = [
      {
        type: 'tool',
        id: 'tool-1',
        name: 'read_file',
        state: { status: 'error', input: {}, error: 'missing_file' },
      },
    ]

    const result = deriveWorkspaceMessageRuntimeState({
      role: 'assistant',
      completedAt: Date.now(),
      parts,
    })

    expect(result).toEqual({
      pending: false,
      statusInfo: {
        status: 'error',
        toolName: 'read_file',
        detail: 'missing_file',
      },
    })
  })
})

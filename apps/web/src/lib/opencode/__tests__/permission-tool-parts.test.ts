import { describe, expect, it } from 'vitest'

import { selectPermissionToolParts } from '@/lib/opencode/permission-tool-parts'
import type { WorkspaceMessage } from '@/lib/opencode/types'

function makePermission(id: string, sessionId: string, callId?: string) {
  return {
    id,
    sessionId,
    ...(callId ? { callId } : {}),
    title: 'Tool approval required',
    state: 'pending' as const,
  }
}

function makeMessage(id: string, sessionId: string, parts: WorkspaceMessage['parts']): WorkspaceMessage {
  return {
    id,
    sessionId,
    role: 'assistant',
    content: '',
    timestamp: '2026-01-01T00:00:00Z',
    parts,
  }
}

describe('selectPermissionToolParts', () => {
  it('resolves a permission whose tool part already arrived (tool-part-first ordering)', () => {
    const messages = {
      s1: [
        makeMessage('m1', 's1', [
          { type: 'tool', id: 'call-1', name: 'arche_zendesk_z1_create_ticket_public', state: { status: 'pending', input: { subject: 'Hi' } } },
        ]),
      ],
    }
    const result = selectPermissionToolParts(messages, [makePermission('p1', 's1', 'call-1')])

    expect(result.p1).toEqual({
      toolName: 'arche_zendesk_z1_create_ticket_public',
      input: { subject: 'Hi' },
    })
  })

  it('keeps loading when the permission session has no cached messages yet (permission-first ordering)', () => {
    const result = selectPermissionToolParts({}, [makePermission('p1', 's1', 'call-1')])

    expect(result.p1).toBeUndefined()
  })

  it('resolves after hydration when messages arrive later', () => {
    const empty = selectPermissionToolParts({}, [makePermission('p1', 's1', 'call-1')])
    expect(empty.p1).toBeUndefined()

    const hydrated = selectPermissionToolParts(
      {
        s1: [
          makeMessage('m1', 's1', [
            { type: 'tool', id: 'call-1', name: 'arche_zendesk_z1_get_ticket', state: { status: 'running', input: { ticketId: 5 } } },
          ]),
        ],
      },
      [makePermission('p1', 's1', 'call-1')],
    )
    expect(hydrated.p1).toEqual({ toolName: 'arche_zendesk_z1_get_ticket', input: { ticketId: 5 } })
  })

  it('reports retrieval failure when the session is loaded but the call id is missing', () => {
    const messages = {
      s1: [
        makeMessage('m1', 's1', [
          { type: 'tool', id: 'other-call', name: 'bash', state: { status: 'pending', input: {} } },
        ]),
      ],
    }
    const result = selectPermissionToolParts(messages, [makePermission('p1', 's1', 'call-1')])

    expect(result.p1).toBeNull()
  })

  it('correlates delegated child sessions referenced by a parent-visible permission', () => {
    const messages = {
      parent: [makeMessage('m-parent', 'parent', [])],
      child: [
        makeMessage('m-child', 'child', [
          { type: 'tool', id: 'call-child', name: 'arche_zendesk_z1_update_ticket_with_public_comment', state: { status: 'pending', input: { ticketId: 9, comment: 'Hi' } } },
        ]),
      ],
    }
    const result = selectPermissionToolParts(messages, [
      makePermission('p1', 'child', 'call-child'),
    ])

    expect(result.p1).toEqual({
      toolName: 'arche_zendesk_z1_update_ticket_with_public_comment',
      input: { ticketId: 9, comment: 'Hi' },
    })
  })

  it('ignores permissions without a call id and non-tool parts', () => {
    const messages = {
      s1: [
        makeMessage('m1', 's1', [{ type: 'text', text: 'hello' }]),
      ],
    }
    const result = selectPermissionToolParts(messages, [makePermission('p1', 's1')])

    expect(result.p1).toBeUndefined()
  })
})

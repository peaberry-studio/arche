/** @vitest-environment jsdom */

import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { PermissionCard } from '@/components/workspace/chat-panel/permission-card'
import type { WorkspacePermission } from '@/lib/opencode/permission'
import type { PermissionToolPart } from '@/lib/opencode/permission-tool-parts'

function makePermission(overrides: Partial<WorkspacePermission> = {}): WorkspacePermission {
  return {
    id: 'perm-1',
    sessionId: 's1',
    callId: 'call-1',
    title: 'Approval required',
    state: 'pending',
    ...overrides,
  }
}

const ZENDESK_TOOL_PART: PermissionToolPart = {
  toolName: 'arche_zendesk_z1_create_ticket_public',
  input: {
    subject: 'Need help',
    comment: 'The issue started this morning.',
    priority: 'high',
  },
}

// Production permission events reference the full MCP tool name in the title
// or pattern; mirror that so recognition works before the tool part arrives.
function makeZendeskPermission(toolName: string, overrides: Partial<WorkspacePermission> = {}): WorkspacePermission {
  return makePermission({ title: toolName, pattern: toolName, ...overrides })
}

describe('PermissionCard Zendesk previews', () => {
  afterEach(() => {
    cleanup()
    vi.unstubAllGlobals()
  })

  function renderCard(permission: WorkspacePermission, toolPart?: PermissionToolPart | null) {
    const onAnswerPermission = vi.fn().mockResolvedValue(true)
    render(
      <PermissionCard
        onAnswerPermission={onAnswerPermission}
        permission={permission}
        toolPart={toolPart}
      />
    )
    return onAnswerPermission
  }

  function expectButtonsDisabled(disabled: boolean) {
    for (const label of ['Allow once', 'Allow for this session', 'Reject']) {
      const button = screen.getByRole('button', { name: label }) as HTMLButtonElement
      expect(button.disabled).toBe(disabled)
    }
  }

  it('shows connector, action, visibility, and fields for a resolved preview', () => {
    renderCard(
      makeZendeskPermission(ZENDESK_TOOL_PART.toolName),
      ZENDESK_TOOL_PART,
    )

    expect(screen.getByText('Zendesk')).toBeTruthy()
    expect(screen.getByText('Create ticket with a public comment')).toBeTruthy()
    expect(screen.getByText('Public')).toBeTruthy()
    expect(screen.getByText('Need help')).toBeTruthy()
    expect(screen.getByText('The issue started this morning.')).toBeTruthy()
    expect(screen.getByText('high')).toBeTruthy()
    expect(screen.queryByText('arche_zendesk_z1_create_ticket_public')).toBeNull()
    expectButtonsDisabled(false)
  })

  it('labels internal notes as internal', () => {
    renderCard(
      makeZendeskPermission('arche_zendesk_z1_update_ticket_with_internal_note'),
      {
        toolName: 'arche_zendesk_z1_update_ticket_with_internal_note',
        input: { ticketId: 42, comment: 'Internal only' },
      },
    )

    expect(screen.getByText('Internal')).toBeTruthy()
    expect(screen.getByText('Update ticket with an internal note')).toBeTruthy()
    expect(screen.getByText('42')).toBeTruthy()
  })

  it('previews ticket creation with subject, comment, and optional fields', () => {
    renderCard(
      makeZendeskPermission('arche_zendesk_z1_create_ticket_internal'),
      {
        toolName: 'arche_zendesk_z1_create_ticket_internal',
        input: { subject: 'Note', comment: 'Context', status: 'new', tags: ['a', 'b'] },
      },
    )

    expect(screen.getByText('Note')).toBeTruthy()
    expect(screen.getByText('a, b')).toBeTruthy()
    expect(screen.getByText('new')).toBeTruthy()
  })

  it('previews ticket updates with the target ticket and changed fields', () => {
    renderCard(
      makeZendeskPermission('arche_zendesk_z1_update_ticket_fields'),
      {
        toolName: 'arche_zendesk_z1_update_ticket_fields',
        input: { ticketId: 42, status: 'solved' },
      },
    )

    expect(screen.getByText('Update ticket fields')).toBeTruthy()
    expect(screen.getByText('42')).toBeTruthy()
    expect(screen.getByText('solved')).toBeTruthy()
  })

  it('disables responses and shows a loading state while the tool input is unresolved', () => {
    renderCard(makeZendeskPermission('arche_zendesk_z1_create_ticket_public'), undefined)

    expect(screen.getByText('Loading approval details...')).toBeTruthy()
    expectButtonsDisabled(true)
  })

  it('disables responses and shows a retrieval error when the tool input cannot be found', () => {
    renderCard(makeZendeskPermission('arche_zendesk_z1_create_ticket_public'), null)

    expect(screen.getByText(/Could not load the details of this Zendesk action/)).toBeTruthy()
    expectButtonsDisabled(true)
  })

  it('never submits while the preview is unavailable', async () => {
    const onAnswerPermission = renderCard(
      makeZendeskPermission('arche_zendesk_z1_create_ticket_public'),
      null,
    )

    fireEvent.click(screen.getByRole('button', { name: 'Allow once' }))
    fireEvent.click(screen.getByRole('button', { name: 'Reject' }))

    await waitFor(() => {
      expect(onAnswerPermission).not.toHaveBeenCalled()
    })
  })

  it('keeps the generic fallback for non-Zendesk permissions', () => {
    renderCard(
      makePermission({ title: 'bash', pattern: 'rm -rf', callId: undefined }),
      undefined,
    )

    expect(screen.queryByText('Loading approval details...')).toBeNull()
    expect(screen.getByText('bash')).toBeTruthy()
    expectButtonsDisabled(false)
  })

  it('sends the existing response values from a previewed permission', async () => {
    const onAnswerPermission = renderCard(
      makeZendeskPermission(ZENDESK_TOOL_PART.toolName),
      ZENDESK_TOOL_PART,
    )

    fireEvent.click(screen.getByRole('button', { name: 'Allow for this session' }))

    await waitFor(() => {
      expect(onAnswerPermission).toHaveBeenCalledWith('s1', 'perm-1', 'always')
    })
  })
})

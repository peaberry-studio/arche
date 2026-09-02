import { describe, expect, it } from 'vitest'

import {
  buildZendeskPermissionPreview,
  matchZendeskActionName,
} from '@/lib/connectors/zendesk-permission-preview'

describe('matchZendeskActionName', () => {
  it('matches atomic action suffixes in MCP tool names', () => {
    expect(matchZendeskActionName('arche_zendesk_z1_create_ticket_public')).toBe('create_ticket_public')
    expect(matchZendeskActionName('arche_zendesk_z1_update_ticket_with_internal_note')).toBe('update_ticket_with_internal_note')
    expect(matchZendeskActionName('arche_zendesk_z1_search_tickets')).toBe('search_tickets')
  })

  it('rejects retired composite tool names and unknown tools', () => {
    expect(matchZendeskActionName('arche_zendesk_z1_create_ticket')).toBeNull()
    expect(matchZendeskActionName('arche_zendesk_z1_update_ticket')).toBeNull()
    expect(matchZendeskActionName('arche_linear_1_list_issues')).toBeNull()
    expect(matchZendeskActionName(undefined)).toBeNull()
  })
})

describe('buildZendeskPermissionPreview', () => {
  it('returns null for non-Zendesk tools', () => {
    expect(buildZendeskPermissionPreview('arche_linear_1_list_issues', {})).toBeNull()
    expect(buildZendeskPermissionPreview('bash', { command: 'ls' })).toBeNull()
  })

  it('previews a public ticket creation with whitelisted fields', () => {
    const preview = buildZendeskPermissionPreview('arche_zendesk_z1_create_ticket_public', {
      subject: 'Need help',
      comment: 'The issue started this morning.',
      priority: 'high',
      tags: ['vip', 'urgent'],
      secretField: 'should-not-render',
    })

    expect(preview).not.toBeNull()
    expect(preview!.connectorName).toBe('Zendesk')
    expect(preview!.action).toBe('create_ticket_public')
    expect(preview!.actionLabel).toBe('Create ticket with a public comment')
    expect(preview!.visibility).toBe('public')
    expect(preview!.fields).toEqual([
      { label: 'Subject', value: 'Need help' },
      { label: 'Comment', value: 'The issue started this morning.' },
      { label: 'Priority', value: 'high' },
      { label: 'Tags', value: 'vip, urgent' },
    ])
  })

  it('previews an internal note update with ticket id and fields', () => {
    const preview = buildZendeskPermissionPreview('arche_zendesk_z1_update_ticket_with_internal_note', {
      ticketId: 42,
      comment: 'Root cause identified.',
      status: 'solved',
      assigneeId: 7,
    })

    expect(preview!.visibility).toBe('internal')
    expect(preview!.actionLabel).toBe('Update ticket with an internal note')
    expect(preview!.fields).toEqual([
      { label: 'Ticket ID', value: '42' },
      { label: 'Comment', value: 'Root cause identified.' },
      { label: 'Status', value: 'solved' },
      { label: 'Assignee ID', value: '7' },
    ])
  })

  it('previews field-only updates without visibility', () => {
    const preview = buildZendeskPermissionPreview('arche_zendesk_z1_update_ticket_fields', {
      ticketId: 42,
      status: 'open',
    })

    expect(preview!.visibility).toBeNull()
    expect(preview!.actionLabel).toBe('Update ticket fields')
    expect(preview!.fields).toEqual([
      { label: 'Ticket ID', value: '42' },
      { label: 'Status', value: 'open' },
    ])
  })

  it('previews reads with their query or ticket id', () => {
    const search = buildZendeskPermissionPreview('arche_zendesk_z1_search_tickets', {
      query: 'status:open urgent',
    })
    expect(search!.fields).toEqual([{ label: 'Query', value: 'status:open urgent' }])

    const read = buildZendeskPermissionPreview('arche_zendesk_z1_get_ticket', { ticketId: 7 })
    expect(read!.fields).toEqual([{ label: 'Ticket ID', value: '7' }])
  })

  it('omits empty values and never renders non-scalar data', () => {
    const preview = buildZendeskPermissionPreview('arche_zendesk_z1_create_ticket_internal', {
      subject: 'Note',
      comment: '',
      metadata: { nested: 'object' },
    })

    expect(preview!.fields).toEqual([{ label: 'Subject', value: 'Note' }])
  })
})

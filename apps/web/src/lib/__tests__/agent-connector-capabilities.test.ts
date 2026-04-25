import { describe, expect, it } from 'vitest'

import { buildAgentConnectorCapabilityOptions } from '@/lib/agent-connector-capabilities'

describe('agent connector capabilities', () => {
  it('includes built-in connector types and custom connectors across human and service users', () => {
    const options = buildAgentConnectorCapabilityOptions([
      {
        id: 'linear-user-1',
        type: 'linear',
        name: 'Linear',
        enabled: true,
        user: { kind: 'HUMAN', slug: 'alice' },
      },
      {
        id: 'custom-user-1',
        type: 'custom',
        name: 'Alice MCP',
        enabled: true,
        user: { kind: 'HUMAN', slug: 'alice' },
      },
      {
        id: 'custom-service-1',
        type: 'custom',
        name: 'Slack MCP',
        enabled: false,
        user: { kind: 'SERVICE', slug: 'slack-bot' },
      },
    ])

    expect(options).toEqual([
      {
        id: 'globalahrefs',
        type: 'ahrefs',
        name: 'Ahrefs',
        enabled: false,
        scope: 'type',
        ownerKind: null,
        ownerSlug: null,
      },
      {
        id: 'globalgooglecalendar',
        type: 'google_calendar',
        name: 'Google Calendar',
        enabled: false,
        scope: 'type',
        ownerKind: null,
        ownerSlug: null,
      },
      {
        id: 'globalgooglechat',
        type: 'google_chat',
        name: 'Google Chat',
        enabled: false,
        scope: 'type',
        ownerKind: null,
        ownerSlug: null,
      },
      {
        id: 'globalgoogledrive',
        type: 'google_drive',
        name: 'Google Drive',
        enabled: false,
        scope: 'type',
        ownerKind: null,
        ownerSlug: null,
      },
      {
        id: 'globalgooglegmail',
        type: 'google_gmail',
        name: 'Gmail',
        enabled: false,
        scope: 'type',
        ownerKind: null,
        ownerSlug: null,
      },
      {
        id: 'globalgooglepeople',
        type: 'google_people',
        name: 'People API',
        enabled: false,
        scope: 'type',
        ownerKind: null,
        ownerSlug: null,
      },
      {
        id: 'globallinear',
        type: 'linear',
        name: 'Linear',
        enabled: true,
        scope: 'type',
        ownerKind: null,
        ownerSlug: null,
      },
      {
        id: 'globalnotion',
        type: 'notion',
        name: 'Notion',
        enabled: false,
        scope: 'type',
        ownerKind: null,
        ownerSlug: null,
      },
      {
        id: 'globalumami',
        type: 'umami',
        name: 'Umami',
        enabled: false,
        scope: 'type',
        ownerKind: null,
        ownerSlug: null,
      },
      {
        id: 'globalzendesk',
        type: 'zendesk',
        name: 'Zendesk',
        enabled: false,
        scope: 'type',
        ownerKind: null,
        ownerSlug: null,
      },
      {
        id: 'custom-user-1',
        type: 'custom',
        name: 'Alice MCP',
        enabled: true,
        scope: 'connector',
        ownerKind: 'HUMAN',
        ownerSlug: 'alice',
      },
      {
        id: 'custom-service-1',
        type: 'custom',
        name: 'Slack MCP',
        enabled: false,
        scope: 'connector',
        ownerKind: 'SERVICE',
        ownerSlug: 'slack-bot',
      },
    ])
  })

  it('coalesces multiple single-instance connectors into one global capability per type', () => {
    const options = buildAgentConnectorCapabilityOptions([
      {
        id: 'linear-user-1',
        type: 'linear',
        name: 'Linear',
        enabled: false,
        user: { kind: 'HUMAN', slug: 'alice' },
      },
      {
        id: 'linear-user-2',
        type: 'linear',
        name: 'Linear',
        enabled: true,
        user: { kind: 'SERVICE', slug: 'slack-bot' },
      },
    ])

    expect(options.filter((option) => option.type === 'linear')).toEqual([
      {
        id: 'globallinear',
        type: 'linear',
        name: 'Linear',
        enabled: true,
        scope: 'type',
        ownerKind: null,
        ownerSlug: null,
      },
    ])
  })
})

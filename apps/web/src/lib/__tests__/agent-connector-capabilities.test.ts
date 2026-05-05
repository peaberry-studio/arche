import { describe, expect, it, vi } from 'vitest'

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
        id: 'globalmetaads',
        type: 'meta-ads',
        name: 'Meta Ads',
        enabled: false,
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

  it('omits unavailable connector types', async () => {
    vi.resetModules()
    vi.doMock('@/lib/runtime/capabilities', () => ({
      getRuntimeCapabilities: vi.fn(() => ({ metaAdsConnector: false })),
    }))

    const { buildAgentConnectorCapabilityOptions: buildOptions } = await import('@/lib/agent-connector-capabilities')
    const options = buildOptions([
      {
        id: 'meta-ads-1',
        type: 'meta-ads',
        name: 'Meta Ads',
        enabled: true,
        user: { kind: 'HUMAN', slug: 'alice' },
      },
    ])

    expect(options.some((option) => option.type === 'meta-ads')).toBe(false)
    vi.doUnmock('@/lib/runtime/capabilities')
  })

  it('loads available connector capability records from inventory entries', async () => {
    vi.resetModules()
    const findCapabilityInventoryEntries = vi.fn().mockResolvedValue([
      {
        id: 'custom-user-1',
        type: 'custom',
        name: 'Alice MCP',
        enabled: true,
        user: { kind: 'HUMAN', slug: 'alice' },
      },
    ])
    vi.doMock('@/lib/services', () => ({
      connectorService: { findCapabilityInventoryEntries },
    }))

    const { loadAvailableConnectorCapabilities } = await import('@/lib/agent-connector-capabilities')

    await expect(loadAvailableConnectorCapabilities()).resolves.toContainEqual({
      id: 'custom-user-1',
      type: 'custom',
    })
    expect(findCapabilityInventoryEntries).toHaveBeenCalledTimes(1)
    vi.doUnmock('@/lib/services')
  })
})

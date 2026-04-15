import { afterEach, describe, expect, it, vi } from 'vitest'

import { executeZendeskMcpTool, getZendeskMcpTools } from '@/lib/connectors/zendesk'
import {
  DEFAULT_ZENDESK_CONNECTOR_PERMISSIONS,
  type ZendeskConnectorConfig,
  type ZendeskConnectorPermissions,
  type ZendeskMcpToolResult,
} from '@/lib/connectors/zendesk-types'

function buildConfig(
  permissions: Partial<ZendeskConnectorPermissions> = {}
): ZendeskConnectorConfig {
  return {
    subdomain: 'acme',
    email: 'agent@example.com',
    apiToken: 'token-123',
    permissions: {
      ...DEFAULT_ZENDESK_CONNECTOR_PERMISSIONS,
      ...permissions,
    },
  }
}

function parseToolResult(result: ZendeskMcpToolResult): unknown {
  return JSON.parse(result.content[0]?.text ?? 'null')
}

describe('zendesk-tools', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('filters unavailable tools from tools/list based on connector permissions', () => {
    const toolNames = getZendeskMcpTools(buildConfig({
      allowRead: false,
      allowCreateTickets: false,
      allowUpdateTickets: true,
    })).map((tool) => tool.name)

    expect(toolNames).toEqual(['update_ticket'])
  })

  it('does not expose internal permission metadata in tools/list', () => {
    const tools = getZendeskMcpTools(buildConfig())

    expect(tools.every((tool) => !Object.prototype.hasOwnProperty.call(tool, 'permission'))).toBe(true)
  })

  it('rejects read operations when read access is disabled', async () => {
    const fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)

    const result = await executeZendeskMcpTool(
      buildConfig({ allowRead: false }),
      'get_ticket',
      { ticketId: 42 }
    )

    expect(parseToolResult(result)).toEqual({
      ok: false,
      error: 'operation_not_allowed',
      message: 'Read operations are disabled for this Zendesk connector',
    })
    expect(result.isError).toBe(true)
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('rejects public comments when they are disabled', async () => {
    const fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)

    const result = await executeZendeskMcpTool(
      buildConfig({ allowPublicComments: false, allowInternalComments: true }),
      'create_ticket',
      {
        subject: 'Need help',
        comment: 'Please check this issue',
      }
    )

    expect(parseToolResult(result)).toEqual({
      ok: false,
      error: 'operation_not_allowed',
      message: 'Public comments are disabled for this Zendesk connector',
    })
    expect(result.isError).toBe(true)
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('rejects internal comments when they are disabled', async () => {
    const fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)

    const result = await executeZendeskMcpTool(
      buildConfig({ allowPublicComments: true, allowInternalComments: false }),
      'update_ticket',
      {
        ticketId: 42,
        comment: 'Internal note',
        publicComment: false,
      }
    )

    expect(parseToolResult(result)).toEqual({
      ok: false,
      error: 'operation_not_allowed',
      message: 'Internal comments are disabled for this Zendesk connector',
    })
    expect(result.isError).toBe(true)
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('allows ticket updates without comments even when comment permissions are disabled', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ ticket: { id: 42, subject: 'Updated', status: 'open' } }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      })
    )
    vi.stubGlobal('fetch', fetchMock)

    const result = await executeZendeskMcpTool(
      buildConfig({ allowPublicComments: false, allowInternalComments: false }),
      'update_ticket',
      {
        ticketId: 42,
        subject: 'Updated',
      }
    )

    expect(parseToolResult(result)).toEqual({
      ok: true,
      ticket: {
        id: 42,
        subject: 'Updated',
        status: 'open',
        priority: null,
        type: null,
        requesterId: null,
        assigneeId: null,
        organizationId: null,
        createdAt: null,
        updatedAt: null,
        tags: [],
        url: 'https://acme.zendesk.com/agent/tickets/42',
      },
    })

    const [, requestInit] = fetchMock.mock.calls[0] as [URL, RequestInit]
    expect(JSON.parse(String(requestInit.body))).toEqual({
      ticket: {
        subject: 'Updated',
      },
    })
  })
})

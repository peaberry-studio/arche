import { afterEach, describe, expect, it, vi } from 'vitest'

import { executeZendeskMcpTool, getZendeskMcpTools } from '@/lib/connectors/zendesk'
import {
  DEFAULT_ZENDESK_ACTION_PERMISSIONS,
  DEFAULT_ZENDESK_CONNECTOR_PERMISSIONS,
  type ZendeskActionPermissions,
  type ZendeskConnectorConfig,
  type ZendeskConnectorPermissions,
  type ZendeskMcpToolResult,
} from '@/lib/connectors/zendesk-types'

function buildConfig(
  overrides: {
    permissions?: Partial<ZendeskConnectorPermissions>
    actions?: Partial<ZendeskActionPermissions>
  } = {}
): ZendeskConnectorConfig {
  return {
    subdomain: 'acme',
    email: 'agent@example.com',
    apiToken: 'token-123',
    permissions: {
      ...DEFAULT_ZENDESK_CONNECTOR_PERMISSIONS,
      ...overrides.permissions,
    },
    ...(overrides.actions ? { zendeskActionPermissions: { ...DEFAULT_ZENDESK_ACTION_PERMISSIONS, ...overrides.actions } } : {}),
  }
}

function parseToolResult(result: ZendeskMcpToolResult): unknown {
  return JSON.parse(result.content[0]?.text ?? 'null')
}

describe('zendesk-tools', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('exposes the eight atomic actions and no legacy composite tools', () => {
    const names = getZendeskMcpTools(buildConfig()).map((tool) => tool.name)
    expect(names).toEqual([
      'search_tickets',
      'get_ticket',
      'list_ticket_comments',
      'create_ticket_public',
      'create_ticket_internal',
      'update_ticket_fields',
      'update_ticket_with_public_comment',
      'update_ticket_with_internal_note',
    ])
  })

  it('omits publicComment from every write tool schema', () => {
    const tools = getZendeskMcpTools(buildConfig())
    for (const tool of tools) {
      if (!tool.name.startsWith('create_ticket') && !tool.name.startsWith('update_ticket')) continue
      expect(tool.inputSchema).not.toHaveProperty('properties.publicComment')
    }
  })

  it('requires a comment for visibility-specific updates and omits it from update_ticket_fields', () => {
    const tools = getZendeskMcpTools(buildConfig())
    const schemaOf = (name: string) => tools.find((tool) => tool.name === name)?.inputSchema

    expect(schemaOf('update_ticket_with_public_comment')).toHaveProperty('required')
    expect(schemaOf('update_ticket_with_internal_note')).toHaveProperty('required')
    expect(schemaOf('update_ticket_fields')).not.toHaveProperty('properties.comment')
  })

  it('does not expose internal permission metadata in tools/list', () => {
    const tools = getZendeskMcpTools(buildConfig())

    expect(tools.every((tool) => !Object.prototype.hasOwnProperty.call(tool, 'action'))).toBe(true)
  })

  it('filters denied actions from tools/list while non-denied actions remain available', () => {
    const names = getZendeskMcpTools(buildConfig({
      actions: {
        search_tickets: 'deny',
        create_ticket_public: 'deny',
        update_ticket_fields: 'deny',
      },
    })).map((tool) => tool.name)

    expect(names).toEqual([
      'get_ticket',
      'list_ticket_comments',
      'create_ticket_internal',
      'update_ticket_with_public_comment',
      'update_ticket_with_internal_note',
    ])
  })

  it('migrates legacy booleans for inventory filtering without stored canonical policies', () => {
    const names = getZendeskMcpTools(buildConfig({
      permissions: {
        allowRead: false,
        allowCreateTickets: false,
        allowUpdateTickets: true,
      },
    })).map((tool) => tool.name)

    expect(names).toEqual([
      'update_ticket_fields',
      'update_ticket_with_public_comment',
      'update_ticket_with_internal_note',
    ])
  })

  it('rejects direct invocation of a denied action before any Zendesk request', async () => {
    const fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)

    const result = await executeZendeskMcpTool(
      buildConfig({ actions: { create_ticket_public: 'deny' } }),
      'create_ticket_public',
      { subject: 'Need help', comment: 'Please check this issue' }
    )

    expect(parseToolResult(result)).toEqual({
      ok: false,
      error: 'operation_not_allowed',
      message: 'This Zendesk action is denied for this connector',
    })
    expect(result.isError).toBe(true)
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('rejects direct invocation of an action denied through legacy migration', async () => {
    const fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)

    const result = await executeZendeskMcpTool(
      buildConfig({ permissions: { allowRead: false } }),
      'get_ticket',
      { ticketId: 42 }
    )

    expect(parseToolResult(result)).toMatchObject({ ok: false, error: 'operation_not_allowed' })
    expect(result.isError).toBe(true)
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('creates a public ticket with the visibility from the tool identity', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ ticket: { id: 99, subject: 'Need help', status: 'open' } }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      })
    )
    vi.stubGlobal('fetch', fetchMock)

    const result = await executeZendeskMcpTool(
      buildConfig(),
      'create_ticket_public',
      { subject: 'Need help', comment: 'Please help', priority: 'high', status: 'open', tags: ['vip'] }
    )

    const parsed = parseToolResult(result) as { ok: boolean; ticket: { id: number } }
    expect(parsed.ok).toBe(true)
    expect(parsed.ticket.id).toBe(99)

    const [url] = fetchMock.mock.calls[0] as [URL]
    expect(url.pathname).toBe('/api/v2/tickets.json')
    const [, init] = fetchMock.mock.calls[0] as [URL, RequestInit]
    expect(JSON.parse(String(init.body))).toEqual({
      ticket: {
        subject: 'Need help',
        comment: { body: 'Please help', public: true },
        requester: { email: 'agent@example.com' },
        priority: 'high',
        status: 'open',
        tags: ['vip'],
      },
    })
  })

  it('creates an internal ticket with the visibility from the tool identity', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ ticket: { id: 100, subject: 'Note', status: 'open' } }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      })
    )
    vi.stubGlobal('fetch', fetchMock)

    const result = await executeZendeskMcpTool(
      buildConfig(),
      'create_ticket_internal',
      { subject: 'Note', comment: 'Internal context' }
    )

    const parsed = parseToolResult(result) as { ok: boolean }
    expect(parsed.ok).toBe(true)

    const [, init] = fetchMock.mock.calls[0] as [URL, RequestInit]
    expect(JSON.parse(String(init.body))).toEqual({
      ticket: {
        subject: 'Note',
        comment: { body: 'Internal context', public: false },
        requester: { email: 'agent@example.com' },
      },
    })
  })

  it('updates fields without a comment in one request', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ ticket: { id: 42, subject: 'Updated' } }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      })
    )
    vi.stubGlobal('fetch', fetchMock)

    const result = await executeZendeskMcpTool(
      buildConfig(),
      'update_ticket_fields',
      { ticketId: 42, subject: 'Updated', assigneeId: 7 }
    )

    const parsed = parseToolResult(result) as { ok: boolean }
    expect(parsed.ok).toBe(true)

    const [url] = fetchMock.mock.calls[0] as [URL]
    expect(url.pathname).toBe('/api/v2/tickets/42.json')
    const [, init] = fetchMock.mock.calls[0] as [URL, RequestInit]
    expect(JSON.parse(String(init.body))).toEqual({
      ticket: { subject: 'Updated', assigneeId: 7 },
    })
  })

  it('rejects comment input for update_ticket_fields', async () => {
    const fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)

    const result = await executeZendeskMcpTool(
      buildConfig(),
      'update_ticket_fields',
      { ticketId: 42, comment: 'Should not be accepted' }
    )

    const parsed = parseToolResult(result) as { ok: boolean; error: string }
    expect(parsed.ok).toBe(false)
    expect(parsed.error).toBe('invalid_arguments')
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('sends field changes and a public comment in one Zendesk update request', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ ticket: { id: 42 } }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      })
    )
    vi.stubGlobal('fetch', fetchMock)

    const result = await executeZendeskMcpTool(
      buildConfig(),
      'update_ticket_with_public_comment',
      { ticketId: 42, comment: 'Fixed in 2.1', status: 'solved', priority: 'low' }
    )

    const parsed = parseToolResult(result) as { ok: boolean }
    expect(parsed.ok).toBe(true)

    const [url] = fetchMock.mock.calls[0] as [URL]
    expect(url.pathname).toBe('/api/v2/tickets/42.json')
    const [, init] = fetchMock.mock.calls[0] as [URL, RequestInit]
    expect(JSON.parse(String(init.body))).toEqual({
      ticket: {
        comment: { body: 'Fixed in 2.1', public: true },
        status: 'solved',
        priority: 'low',
      },
    })
  })

  it('sends field changes and an internal note in one Zendesk update request', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ ticket: { id: 42 } }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      })
    )
    vi.stubGlobal('fetch', fetchMock)

    const result = await executeZendeskMcpTool(
      buildConfig(),
      'update_ticket_with_internal_note',
      { ticketId: 42, comment: 'Root cause identified' }
    )

    const parsed = parseToolResult(result) as { ok: boolean }
    expect(parsed.ok).toBe(true)

    const [, init] = fetchMock.mock.calls[0] as [URL, RequestInit]
    expect(JSON.parse(String(init.body))).toEqual({
      ticket: {
        comment: { body: 'Root cause identified', public: false },
      },
    })
  })

  it('rejects visibility-specific updates without a comment', async () => {
    const fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)

    const result = await executeZendeskMcpTool(
      buildConfig(),
      'update_ticket_with_public_comment',
      { ticketId: 42, subject: 'No comment' }
    )

    const parsed = parseToolResult(result) as { ok: boolean; error: string }
    expect(parsed.ok).toBe(false)
    expect(parsed.error).toBe('invalid_arguments')
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('rejects an empty update_ticket_fields payload', async () => {
    const fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)

    const result = await executeZendeskMcpTool(
      buildConfig(),
      'update_ticket_fields',
      { ticketId: 42 }
    )

    const parsed = parseToolResult(result) as { ok: boolean; error: string }
    expect(parsed.ok).toBe(false)
    expect(parsed.error).toBe('invalid_arguments')
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('rejects unknown and retired tool names', async () => {
    const fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)

    for (const toolName of ['unknown_tool', 'create_ticket', 'update_ticket']) {
      const result = await executeZendeskMcpTool(buildConfig(), toolName, {})
      const parsed = parseToolResult(result) as { ok: boolean; error: string }
      expect(parsed.ok).toBe(false)
      expect(parsed.error).toBe('unknown_tool')
    }
    expect(fetchMock).not.toHaveBeenCalled()
  })
})

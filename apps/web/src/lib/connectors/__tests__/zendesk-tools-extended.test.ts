import { afterEach, describe, expect, it, vi } from 'vitest'

import { executeZendeskMcpTool, getZendeskMcpTools } from '@/lib/connectors/zendesk'
import {
  DEFAULT_ZENDESK_CONNECTOR_PERMISSIONS,
  type ZendeskConnectorConfig,
  type ZendeskConnectorPermissions,
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

function parseToolResult(result: { content: Array<{ text: string }> }): unknown {
  return JSON.parse(result.content[0]?.text ?? 'null')
}

describe('zendesk-tools extended', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('exposes all tools when all permissions are granted', () => {
    const tools = getZendeskMcpTools(buildConfig())
    const names = tools.map((t) => t.name)
    expect(names).toContain('search_tickets')
    expect(names).toContain('get_ticket')
    expect(names).toContain('list_ticket_comments')
    expect(names).toContain('create_ticket')
    expect(names).toContain('update_ticket')
  })

  it('exposes only read tools when create/update are disabled', () => {
    const tools = getZendeskMcpTools(buildConfig({
      allowCreateTickets: false,
      allowUpdateTickets: false,
    }))
    const names = tools.map((t) => t.name)
    expect(names).toEqual(['search_tickets', 'get_ticket', 'list_ticket_comments'])
  })

  it('returns empty tools list when all permissions are disabled', () => {
    expect(
      getZendeskMcpTools(
        buildConfig({ allowRead: false, allowCreateTickets: false, allowUpdateTickets: false })
      )
    ).toEqual([])
  })

  it('returns protocol version', async () => {
    const { getZendeskMcpProtocolVersion } = await import('@/lib/connectors/zendesk-tools')
    expect(getZendeskMcpProtocolVersion()).toBe('2025-03-26')
  })

  it('rejects create when create permission is disabled', async () => {
    const result = await executeZendeskMcpTool(
      buildConfig({ allowCreateTickets: false }),
      'create_ticket',
      { subject: 'Test', comment: 'Body' }
    )

    expect(result.isError).toBe(true)
    const parsed = parseToolResult(result) as { ok: boolean; error: string }
    expect(parsed.ok).toBe(false)
    expect(parsed.error).toBe('operation_not_allowed')
  })

  it('rejects update when update permission is disabled', async () => {
    const result = await executeZendeskMcpTool(
      buildConfig({ allowUpdateTickets: false }),
      'update_ticket',
      { ticketId: 42, subject: 'Updated' }
    )

    expect(result.isError).toBe(true)
    const parsed = parseToolResult(result) as { ok: boolean; error: string }
    expect(parsed.ok).toBe(false)
    expect(parsed.error).toBe('operation_not_allowed')
  })

  it('creates a ticket successfully', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ ticket: { id: 99, subject: 'Need help', status: 'open' } }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      })
    )
    vi.stubGlobal('fetch', fetchMock)

    const result = await executeZendeskMcpTool(
      buildConfig(),
      'create_ticket',
      { subject: 'Need help', comment: 'Please help', priority: 'high', status: 'open' }
    )

    const parsed = parseToolResult(result) as { ok: boolean; ticket: { id: number } }
    expect(parsed.ok).toBe(true)
    expect(parsed.ticket.id).toBe(99)

    const [url] = fetchMock.mock.calls[0] as [URL]
    expect(url.pathname).toBe('/api/v2/tickets.json')
    const [, init] = fetchMock.mock.calls[0] as [URL, RequestInit]
    const body = JSON.parse(String(init.body))
    expect(body.ticket.subject).toBe('Need help')
    expect(body.ticket.priority).toBe('high')
    expect(body.ticket.status).toBe('open')
    expect(body.ticket.comment).toEqual({ body: 'Please help', public: true })
  })

  it('searches tickets with scoped query', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({
        results: [{ id: 1, subject: 'Bug' }],
        count: 1,
        next_page: null,
        previous_page: null,
      }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      })
    )
    vi.stubGlobal('fetch', fetchMock)

    const result = await executeZendeskMcpTool(
      buildConfig(),
      'search_tickets',
      { query: 'status:open', page: 2, perPage: 50 }
    )

    const parsed = parseToolResult(result) as { ok: boolean; tickets: unknown[]; page: number }
    expect(parsed.ok).toBe(true)
    expect(parsed.tickets).toHaveLength(1)
    expect(parsed.page).toBe(2)

    const [url] = fetchMock.mock.calls[0] as [URL]
    expect(url.searchParams.get('query')).toBe('type:ticket status:open')
    expect(url.searchParams.get('page')).toBe('2')
    expect(url.searchParams.get('per_page')).toBe('50')
  })

  it('lists ticket comments', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({
        comments: [
          { id: 101, author_id: 1, body: 'First', public: true, created_at: '2026-01-01' },
        ],
      }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      })
    )
    vi.stubGlobal('fetch', fetchMock)

    const result = await executeZendeskMcpTool(
      buildConfig(),
      'list_ticket_comments',
      { ticketId: 42 }
    )

    const parsed = parseToolResult(result) as { ok: boolean; count: number }
    expect(parsed.ok).toBe(true)
    expect(parsed.count).toBe(1)

    const [url] = fetchMock.mock.calls[0] as [URL]
    expect(url.pathname).toBe('/api/v2/tickets/42/comments.json')
  })

  it('rejects missing ticketId for get_ticket', async () => {
    const fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)

    const result = await executeZendeskMcpTool(
      buildConfig(),
      'get_ticket',
      {}
    )

    const parsed = parseToolResult(result) as { ok: boolean; error: string }
    expect(parsed.ok).toBe(false)
    expect(parsed.error).toBe('invalid_arguments')
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('rejects invalid page argument', async () => {
    const fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)

    const result = await executeZendeskMcpTool(
      buildConfig(),
      'search_tickets',
      { query: 'test', page: -1 }
    )

    const parsed = parseToolResult(result) as { ok: boolean; error: string }
    expect(parsed.ok).toBe(false)
    expect(parsed.error).toBe('invalid_arguments')
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('rejects invalid perPage argument', async () => {
    const fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)

    const result = await executeZendeskMcpTool(
      buildConfig(),
      'search_tickets',
      { query: 'test', perPage: -5 }
    )

    const parsed = parseToolResult(result) as { ok: boolean; error: string }
    expect(parsed.ok).toBe(false)
    expect(parsed.error).toBe('invalid_arguments')
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('rejects unknown tool name', async () => {
    const fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)

    const result = await executeZendeskMcpTool(
      buildConfig(),
      'unknown_tool',
      {}
    )

    const parsed = parseToolResult(result) as { ok: boolean; error: string }
    expect(parsed.ok).toBe(false)
    expect(parsed.error).toBe('unknown_tool')
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('handles network errors gracefully', async () => {
    const fetchMock = vi.fn().mockRejectedValue(new Error('Network failure'))
    vi.stubGlobal('fetch', fetchMock)

    const result = await executeZendeskMcpTool(
      buildConfig(),
      'search_tickets',
      { query: 'test' }
    )

    expect(result.isError).toBe(true)
    const parsed = parseToolResult(result) as { ok: boolean; error: string }
    expect(parsed.ok).toBe(false)
    expect(parsed.error).toBe('zendesk_request_failed')
  })
})

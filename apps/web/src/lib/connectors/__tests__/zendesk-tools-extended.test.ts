import { afterEach, describe, expect, it, vi } from 'vitest'

import { executeZendeskMcpTool } from '@/lib/connectors/zendesk'
import {
  DEFAULT_ZENDESK_ACTION_PERMISSIONS,
  DEFAULT_ZENDESK_CONNECTOR_PERMISSIONS,
  type ZendeskActionPermissions,
  type ZendeskConnectorConfig,
  type ZendeskConnectorPermissions,
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

function parseToolResult(result: { content: Array<{ text: string }> }): unknown {
  return JSON.parse(result.content[0]?.text ?? 'null')
}

describe('zendesk-tools extended', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('returns protocol version', async () => {
    const { getZendeskMcpProtocolVersion } = await import('@/lib/connectors/zendesk-tools')
    expect(getZendeskMcpProtocolVersion()).toBe('2025-03-26')
  })

  it('executes allow actions without any approval gate at the connector layer', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ ticket: { id: 42, subject: 'Bug' } }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      })
    )
    vi.stubGlobal('fetch', fetchMock)

    const result = await executeZendeskMcpTool(
      buildConfig({ actions: { get_ticket: 'allow' } }),
      'get_ticket',
      { ticketId: 42 }
    )

    const parsed = parseToolResult(result) as { ok: boolean }
    expect(parsed.ok).toBe(true)
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it('executes ask actions at the connector layer because only the managed runtime conducts approval', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ ticket: { id: 42 } }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      })
    )
    vi.stubGlobal('fetch', fetchMock)

    const result = await executeZendeskMcpTool(
      buildConfig({ actions: { update_ticket_fields: 'ask' } }),
      'update_ticket_fields',
      { ticketId: 42, status: 'solved' }
    )

    const parsed = parseToolResult(result) as { ok: boolean }
    expect(parsed.ok).toBe(true)
    expect(fetchMock).toHaveBeenCalledTimes(1)
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

  it('rejects invalid enum arguments for write tools', async () => {
    const fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)

    const result = await executeZendeskMcpTool(
      buildConfig(),
      'create_ticket_public',
      { subject: 'Test', comment: 'Body', status: 'exploded' }
    )

    const parsed = parseToolResult(result) as { ok: boolean; error: string }
    expect(parsed.ok).toBe(false)
    expect(parsed.error).toBe('invalid_arguments')
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('rejects missing subject or comment for creation tools', async () => {
    const fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)

    for (const toolName of ['create_ticket_public', 'create_ticket_internal']) {
      const missingSubject = await executeZendeskMcpTool(buildConfig(), toolName, { comment: 'Body' })
      const parsedSubject = parseToolResult(missingSubject) as { ok: boolean; error: string }
      expect(parsedSubject.ok).toBe(false)
      expect(parsedSubject.error).toBe('invalid_arguments')

      const missingComment = await executeZendeskMcpTool(buildConfig(), toolName, { subject: 'Test' })
      const parsedComment = parseToolResult(missingComment) as { ok: boolean; error: string }
      expect(parsedComment.ok).toBe(false)
      expect(parsedComment.error).toBe('invalid_arguments')
    }
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

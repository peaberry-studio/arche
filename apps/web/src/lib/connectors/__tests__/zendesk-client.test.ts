import { afterEach, describe, expect, it, vi } from 'vitest'

import {
  mapTicket,
  mapTicketComment,
  requestZendeskJson,
  testZendeskConnection,
} from '../zendesk-client'

const config = {
  apiToken: 'zendesk-token',
  email: 'admin@example.com',
  permissions: {
    allowCreateTickets: true,
    allowInternalComments: true,
    allowPublicComments: true,
    allowRead: true,
    allowUpdateTickets: true,
  },
  subdomain: 'acme',
}

function expectHeaders(headers: HeadersInit | undefined): Headers {
  if (!(headers instanceof Headers)) {
    throw new Error('Expected Headers instance')
  }

  return headers
}

describe('zendesk-client', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('maps tickets and comments into the public connector shape', () => {
    expect(mapTicket({
      assignee_id: 2,
      created_at: '2026-04-01T10:00:00Z',
      id: 123,
      organization_id: 3,
      priority: 'high',
      requester_id: 1,
      status: 'open',
      subject: 'Broken login',
      tags: [' urgent ', 42, 'vip'],
      type: 'problem',
      updated_at: '2026-04-02T10:00:00Z',
    }, 'acme')).toEqual({
      assigneeId: 2,
      createdAt: '2026-04-01T10:00:00Z',
      id: 123,
      organizationId: 3,
      priority: 'high',
      requesterId: 1,
      status: 'open',
      subject: 'Broken login',
      tags: ['urgent', 'vip'],
      type: 'problem',
      updatedAt: '2026-04-02T10:00:00Z',
      url: 'https://acme.zendesk.com/agent/tickets/123',
    })
    expect(mapTicket(null, 'acme')).toMatchObject({ id: undefined, subject: null, tags: [], url: null })
    expect(mapTicketComment({
      attachments: [{ id: 1 }, { id: 2 }],
      author_id: 9,
      body: 'Comment body',
      created_at: '2026-04-01T11:00:00Z',
      id: 5,
      public: false,
    })).toEqual({
      attachments: 2,
      authorId: 9,
      body: 'Comment body',
      createdAt: '2026-04-01T11:00:00Z',
      id: 5,
      public: false,
    })
  })

  it('requests JSON with auth, search params, and no-store cache', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ tickets: [] }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      })
    )
    vi.stubGlobal('fetch', fetchMock)

    const result = await requestZendeskJson({
      config,
      path: '/search.json',
      searchParams: { query: 'status:open' },
    })

    expect(result.ok).toBe(true)
    const [requestUrl, init] = fetchMock.mock.calls[0] as [URL, RequestInit]
    const headers = expectHeaders(init.headers)
    expect(requestUrl.toString()).toBe('https://acme.zendesk.com/api/v2/search.json?query=status%3Aopen')
    expect(init.method).toBe('GET')
    expect(init.cache).toBe('no-store')
    expect(headers.get('accept')).toBe('application/json')
    expect(headers.get('authorization')).toBe(`Basic ${Buffer.from('admin@example.com/token:zendesk-token').toString('base64')}`)
    expect(headers.get('user-agent')).toBe('Arche Zendesk Connector')
  })

  it('serializes JSON request bodies for write requests', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ ticket: { id: 1 } }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      })
    )
    vi.stubGlobal('fetch', fetchMock)

    await requestZendeskJson({
      body: { ticket: { subject: 'Hello' } },
      config,
      method: 'POST',
      path: '/tickets.json',
    })

    const [, init] = fetchMock.mock.calls[0] as [URL, RequestInit]
    const headers = expectHeaders(init.headers)
    expect(init.method).toBe('POST')
    expect(init.body).toBe(JSON.stringify({ ticket: { subject: 'Hello' } }))
    expect(headers.get('content-type')).toBe('application/json')
  })

  it('returns null data for 204 responses', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(null, { status: 204 })))

    await expect(requestZendeskJson({ config, path: '/tickets/1.json' })).resolves.toMatchObject({
      data: null,
      ok: true,
      status: 204,
    })
  })

  it('extracts error details and retry-after values from JSON error responses', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ errors: ['First problem', 'Second problem'] }), {
        status: 429,
        headers: {
          'content-type': 'application/json',
          'retry-after': '9.7',
        },
      })
    ))

    const result = await requestZendeskJson({ config, path: '/tickets.json' })

    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.message).toBe('Zendesk request failed (429): First problem; Second problem')
      expect(result.retryAfter).toBe(9)
      expect(result.status).toBe(429)
    }
  })

  it('extracts plain-text error responses', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(
      new Response('Forbidden workspace', {
        status: 403,
        headers: { 'content-type': 'text/plain' },
      })
    ))

    const result = await requestZendeskJson({ config, path: '/tickets.json' })

    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.message).toBe('Zendesk request failed (403): Forbidden workspace')
      expect(result.data).toBe('Forbidden workspace')
    }
  })

  it('returns a structured failure when fetch throws', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('timeout')))

    await expect(requestZendeskJson({ config, path: '/tickets.json' })).resolves.toEqual({
      ok: false,
      error: 'zendesk_request_failed',
      message: 'Zendesk request failed: timeout',
      status: 0,
    })
  })

  it('tests the current Zendesk user endpoint', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ user: { id: 1 } }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      })
    )
    vi.stubGlobal('fetch', fetchMock)

    await expect(testZendeskConnection(config)).resolves.toMatchObject({ ok: true })
    expect((fetchMock.mock.calls[0][0] as URL).pathname).toBe('/api/v2/users/me.json')
  })
})

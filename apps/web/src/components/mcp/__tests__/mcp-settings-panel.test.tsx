/** @vitest-environment jsdom */

import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { McpSettingsPanel } from '@/components/mcp/mcp-settings-panel'

const fetchMock = vi.fn<(input: RequestInfo | URL, init?: RequestInit) => Promise<Response>>()

describe('McpSettingsPanel', () => {
  beforeEach(() => {
    vi.stubGlobal('fetch', fetchMock)
    fetchMock.mockReset()
  })

  afterEach(() => {
    cleanup()
    vi.unstubAllGlobals()
  })

  it('loads personal MCP state with the authenticated user slug and admin state through admin routes', async () => {
    fetchMock.mockImplementation(createMcpFetchMock())

    render(<McpSettingsPanel currentUserEmail="admin@example.com" currentUserId="admin-1" currentUserSlug="admin" isAdmin />)

    expect((await screen.findAllByText(/admin@example\.com/)).length).toBeGreaterThan(0)
    expect(fetchMock).toHaveBeenCalledWith('/api/u/admin/mcp/settings', { cache: 'no-store' })
    expect(fetchMock).toHaveBeenCalledWith('/api/u/admin/mcp/tokens', { cache: 'no-store' })
    expect(fetchMock).toHaveBeenCalledWith('/api/mcp/admin/settings', { cache: 'no-store' })
    expect(fetchMock).toHaveBeenCalledWith('/api/mcp/admin/tokens', { cache: 'no-store' })
  })

  it('creates personal tokens only through the authenticated user slug route', async () => {
    fetchMock.mockImplementation(createMcpFetchMock())

    render(<McpSettingsPanel currentUserEmail="admin@example.com" currentUserId="admin-1" currentUserSlug="admin" isAdmin />)

    await screen.findByRole('button', { name: 'Create token' })
    fireEvent.click(screen.getByRole('button', { name: 'Create token' }))

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledWith('/api/u/admin/mcp/tokens', expect.objectContaining({ method: 'POST' }))
    })
    expect(fetchMock).not.toHaveBeenCalledWith('/api/u/alice/mcp/tokens', expect.anything())
  })

  it('keeps personal and admin token revocation endpoints separate for admins', async () => {
    fetchMock.mockImplementation(createMcpFetchMock())

    render(<McpSettingsPanel currentUserEmail="admin@example.com" currentUserId="admin-1" currentUserSlug="admin" isAdmin />)

    await waitFor(() => expect(screen.getAllByRole('button', { name: 'Revoke' })).toHaveLength(2))
    fireEvent.click(screen.getAllByRole('button', { name: 'Revoke' })[0])

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledWith('/api/u/admin/mcp/tokens/personal-token', { method: 'DELETE' })
    })

    await waitFor(() => expect(screen.getAllByRole('button', { name: 'Revoke' })).toHaveLength(1))
    fireEvent.click(screen.getAllByRole('button', { name: 'Revoke' })[0])

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledWith('/api/mcp/admin/tokens/alice-token', { method: 'DELETE' })
    })
  })
})

function createMcpFetchMock() {
  return async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    const url = String(input)
    const method = init?.method ?? 'GET'

    if (method === 'POST' && url === '/api/u/admin/mcp/tokens') {
      return jsonResponse({
        token: 'arche_pat_secret',
        record: createTokenDto({ id: 'created-token' }),
      }, { status: 201 })
    }

    if (method === 'DELETE') return jsonResponse({ ok: true })
    if (url === '/api/u/admin/mcp/settings') return jsonResponse({ enabled: true, mcpAllowed: true })
    if (url === '/api/u/admin/mcp/tokens') return jsonResponse({ tokens: [createTokenDto({ id: 'personal-token' })] })
    if (url === '/api/mcp/admin/settings') {
      return jsonResponse({
        enabled: true,
        mcpAllowed: true,
        users: [{ id: 'admin-1', email: 'admin@example.com', slug: 'admin', role: 'ADMIN', mcpAllowed: true }],
      })
    }
    if (url === '/api/mcp/admin/tokens') {
      return jsonResponse({
        tokens: [createTokenDto({ id: 'alice-token', user: { id: 'alice-1', email: 'alice@example.com', slug: 'alice' } })],
      })
    }

    return jsonResponse({ error: 'unexpected_request' }, { status: 500 })
  }
}

function createTokenDto(input: Partial<{
  id: string
  user: { id: string; email: string; slug: string }
}> = {}) {
  return {
    id: 'token-1',
    name: 'Arche MCP',
    scopes: ['kb:read'],
    expiresAt: '2026-02-01T00:00:00.000Z',
    revokedAt: null,
    lastUsedAt: null,
    createdAt: '2026-01-01T00:00:00.000Z',
    ...input,
  }
}

function jsonResponse(body: unknown, init?: ResponseInit): Response {
  return new Response(JSON.stringify(body), {
    headers: { 'content-type': 'application/json' },
    ...init,
  })
}

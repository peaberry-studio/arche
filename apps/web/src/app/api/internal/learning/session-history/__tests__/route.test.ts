import { NextRequest } from 'next/server'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  getRuntimeForSlug: vi.fn(),
  getInternalLearningContext: vi.fn(),
}))

vi.mock('@/app/api/internal/learning/auth', () => ({ getInternalLearningContext: mocks.getInternalLearningContext }))
vi.mock('@/lib/harness/registry', () => ({ getRuntimeForSlug: mocks.getRuntimeForSlug }))

import { POST } from '../route'

function makeRequest(body: unknown): NextRequest {
  return new NextRequest('http://localhost/api/internal/learning/session-history', {
    method: 'POST',
    body: JSON.stringify(body),
    headers: { 'Content-Type': 'application/json' },
  })
}

describe('POST /api/internal/learning/session-history', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.getInternalLearningContext.mockResolvedValue({ ok: true, userId: 'user-1', slug: 'alice' })
    mocks.getRuntimeForSlug.mockResolvedValue({ ok: true, data: {
        listSessions: vi.fn().mockResolvedValue({
          ok: true,
          data: [
            { id: 'session-1', title: 'Roadmap planning' },
            { id: 'session-2', title: 'Learning | Roadmap planning' },
            { id: 'session-3', title: 'Support notes' },
          ],
        }),
        listMessages: vi.fn().mockResolvedValue({
          ok: true,
          data: [
            { role: 'user', parts: [{ text: 'Remember this preference', type: 'text' }] },
            { role: 'assistant', parts: [{ text: 'Noted', type: 'text' }] },
          ],
        }),
    } })
  })

  it('returns auth errors from the internal context', async () => {
    mocks.getInternalLearningContext.mockResolvedValue({ ok: false, error: 'unauthorized', status: 401 })

    const response = await POST(makeRequest({}))

    expect(response.status).toBe(401)
  })

  it('returns instance errors', async () => {
    mocks.getRuntimeForSlug.mockResolvedValue({ ok: true, data: {
      listSessions: vi.fn().mockResolvedValue({ ok: false, error: { code: 'instance_unavailable' } }),
    } })

    const response = await POST(makeRequest({}))

    expect(response.status).toBe(503)
    await expect(response.json()).resolves.toEqual({ error: 'instance_unavailable' })
  })

  it('filters sessions and optionally includes messages', async () => {
    const response = await POST(makeRequest({ includeMessages: true, query: 'roadmap', limit: 10, maxMessagesPerSession: 1 }))

    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toEqual({
      sessions: [
        { id: 'session-1', title: 'Roadmap planning', messages: [{ role: 'assistant', text: 'Noted' }] },
      ],
    })
  })

  it('does not turn a typed session-list failure into an empty successful history', async () => {
    mocks.getRuntimeForSlug.mockResolvedValue({ ok: true, data: {
      listSessions: vi.fn().mockResolvedValue({ ok: false, error: { code: 'runtime_error' } }),
    } })
    const response = await POST(makeRequest({}))
    expect(response.status).toBe(502)
    expect(await response.json()).toEqual({ error: 'runtime_error' })
  })

  it('propagates a typed message-read failure', async () => {
    mocks.getRuntimeForSlug.mockResolvedValue({ ok: true, data: {
      listSessions: vi.fn().mockResolvedValue({ ok: true, data: [{ id: 'session-1', title: 'Planning' }] }),
      listMessages: vi.fn().mockResolvedValue({ ok: false, error: { code: 'session_not_found' } }),
    } })
    const response = await POST(makeRequest({ includeMessages: true }))
    expect(response.status).toBe(502)
    expect(await response.json()).toEqual({ error: 'session_not_found' })
  })
})

import { NextRequest } from 'next/server'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  createInstanceClient: vi.fn(),
  getInternalLearningContext: vi.fn(),
}))

vi.mock('@/app/api/internal/learning/auth', () => ({ getInternalLearningContext: mocks.getInternalLearningContext }))
vi.mock('@/lib/opencode/client', () => ({ createInstanceClient: mocks.createInstanceClient }))

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
    mocks.createInstanceClient.mockResolvedValue({
      session: {
        list: vi.fn().mockResolvedValue({
          data: [
            { id: 'session-1', title: 'Roadmap planning' },
            { id: 'session-2', title: 'Learning | Roadmap planning' },
            { id: 'session-3', title: 'Support notes' },
          ],
        }),
        messages: vi.fn().mockResolvedValue({
          data: [
            { info: { role: 'user' }, parts: [{ text: 'Remember this preference', type: 'text' }] },
            { info: { role: 'assistant' }, parts: [{ text: 'Noted', type: 'text' }] },
          ],
        }),
      },
    })
  })

  it('returns auth errors from the internal context', async () => {
    mocks.getInternalLearningContext.mockResolvedValue({ ok: false, error: 'unauthorized', status: 401 })

    const response = await POST(makeRequest({}))

    expect(response.status).toBe(401)
  })

  it('returns instance errors', async () => {
    mocks.createInstanceClient.mockResolvedValue(null)

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
})

import { NextRequest } from 'next/server'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  findIdBySlug: vi.fn(),
  resolveInstanceConnection: vi.fn(),
}))

vi.mock('@/lib/opencode/connection-resolver', () => ({ resolveInstanceConnection: mocks.resolveInstanceConnection }))
vi.mock('@/lib/services', () => ({ userService: { findIdBySlug: mocks.findIdBySlug } }))

import { getInternalLearningContext } from '../auth'

function makeRequest(headers: Record<string, string>): NextRequest {
  return new NextRequest('http://localhost/api/internal/learning/proposals', { headers })
}

describe('getInternalLearningContext', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.resolveInstanceConnection.mockResolvedValue({ authHeader: 'Basic expected' })
    mocks.findIdBySlug.mockResolvedValue({ id: 'user-1' })
  })

  it('rejects missing or mismatched internal auth headers', async () => {
    await expect(getInternalLearningContext(makeRequest({}))).resolves.toEqual({ ok: false, error: 'unauthorized', status: 401 })
    await expect(getInternalLearningContext(makeRequest({
      'x-arche-workspace-slug': 'alice',
      authorization: 'Basic wrong',
    }))).resolves.toEqual({ ok: false, error: 'unauthorized', status: 401 })
  })

  it('returns not_found when the slug has no user', async () => {
    mocks.findIdBySlug.mockResolvedValue(null)

    await expect(getInternalLearningContext(makeRequest({
      'x-arche-workspace-slug': 'alice',
      authorization: 'Basic expected',
    }))).resolves.toEqual({ ok: false, error: 'not_found', status: 404 })
  })

  it('returns the internal learning context', async () => {
    await expect(getInternalLearningContext(makeRequest({
      'x-arche-workspace-slug': ' alice ',
      authorization: 'Basic expected',
    }))).resolves.toEqual({ ok: true, slug: 'alice', userId: 'user-1' })
  })
})

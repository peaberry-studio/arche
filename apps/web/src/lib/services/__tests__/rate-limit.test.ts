import { beforeEach, describe, expect, it, vi } from 'vitest'

const { mockQueryRaw, legacyOperation } = vi.hoisted(() => ({
  mockQueryRaw: vi.fn(),
  legacyOperation: vi.fn(() => {
    throw new Error('legacy rate-limit orchestration used')
  }),
}))

vi.mock('@/lib/prisma', () => ({
  prisma: {
    $queryRaw: mockQueryRaw,
    rateLimitBucket: {
      updateMany: legacyOperation,
      findUnique: legacyOperation,
      findFirst: legacyOperation,
      upsert: legacyOperation,
      deleteMany: vi.fn(),
    },
  },
}))

import { checkDbRateLimit } from '@/lib/services/rate-limit'

describe('checkDbRateLimit', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('uses a single atomic database transition instead of multi-step orchestration', async () => {
    const resetAt = new Date('2026-05-26T12:01:00.000Z')
    mockQueryRaw.mockResolvedValue([{ count: 1, resetAt }])

    const result = await checkDbRateLimit('mcp:ip:127.0.0.1', 5, 60_000)

    expect(result).toEqual({ allowed: true, remaining: 4, resetAt: resetAt.getTime() })
    expect(mockQueryRaw).toHaveBeenCalledTimes(1)
    expect(legacyOperation).not.toHaveBeenCalled()
  })

  it('reports a blocked bucket from the same atomic transition result', async () => {
    const resetAt = new Date('2026-05-26T12:01:00.000Z')
    mockQueryRaw.mockResolvedValue([{ count: 6, reset_at: resetAt }])

    const result = await checkDbRateLimit('mcp:token:abc', 5, 60_000)

    expect(result).toEqual({ allowed: false, remaining: 0, resetAt: resetAt.getTime() })
    expect(mockQueryRaw).toHaveBeenCalledTimes(1)
    expect(legacyOperation).not.toHaveBeenCalled()
  })
})

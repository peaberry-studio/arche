import { beforeEach, describe, expect, it, vi } from 'vitest'

const mockQueryRaw = vi.fn()

vi.mock('@/lib/prisma', () => ({
  prisma: {
    $queryRaw: (...args: unknown[]) => mockQueryRaw(...args),
  },
}))

import { checkMcpRateLimit } from '../rate-limit'

describe('checkMcpRateLimit', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('allows requests under the limit', async () => {
    mockQueryRaw.mockResolvedValue([{ count: 1, resetAt: new Date('2026-05-21T18:00:00.000Z') }])

    await expect(checkMcpRateLimit('mcp:tok-1', 5, 60000)).resolves.toEqual({
      allowed: true,
      remaining: 4,
      resetAt: new Date('2026-05-21T18:00:00.000Z').getTime(),
    })
  })

  it('blocks requests that exceed the limit', async () => {
    mockQueryRaw.mockResolvedValue([{ count: 6, resetAt: new Date('2026-05-21T18:00:00.000Z') }])

    await expect(checkMcpRateLimit('mcp:tok-1', 5, 60000)).resolves.toEqual({
      allowed: false,
      remaining: 0,
      resetAt: new Date('2026-05-21T18:00:00.000Z').getTime(),
    })
  })

  it('normalizes bigint counts returned by PostgreSQL', async () => {
    mockQueryRaw.mockResolvedValue([{ count: 2n, resetAt: new Date('2026-05-21T18:00:00.000Z') }])

    await expect(checkMcpRateLimit('mcp:tok-1', 5, 60000)).resolves.toEqual({
      allowed: true,
      remaining: 3,
      resetAt: new Date('2026-05-21T18:00:00.000Z').getTime(),
    })
  })

  it('throws when the database query returns no bucket row', async () => {
    mockQueryRaw.mockResolvedValue([])

    await expect(checkMcpRateLimit('mcp:tok-1', 5, 60000)).rejects.toThrow(
      'mcp_rate_limit_failed'
    )
  })
})

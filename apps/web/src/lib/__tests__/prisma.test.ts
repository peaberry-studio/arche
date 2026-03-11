import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@prisma/adapter-pg', () => ({
  PrismaPg: vi.fn(),
}))

vi.mock('pg', () => ({
  Pool: vi.fn(),
}))

vi.mock('@prisma/client', () => ({
  PrismaClient: vi.fn().mockImplementation(() => ({ _isMockClient: true })),
}))

describe('prisma dispatcher', () => {
  const originalEnv = process.env

  beforeEach(() => {
    vi.resetModules()
    vi.clearAllMocks()
    process.env = { ...originalEnv }
    // @ts-expect-error -- reset global for test isolation
    globalThis.prisma = undefined
    // @ts-expect-error -- reset global for test isolation
    globalThis.prismaPool = undefined
  })

  afterEach(() => {
    process.env = originalEnv
    // @ts-expect-error -- reset global for test isolation
    globalThis.prisma = undefined
    // @ts-expect-error -- reset global for test isolation
    globalThis.prismaPool = undefined
  })

  it('creates a PrismaClient in web mode', async () => {
    delete process.env.ARCHE_RUNTIME_MODE
    process.env.DATABASE_URL = 'postgresql://localhost/test'

    const { prisma } = await import('../prisma')
    expect(prisma).toBeDefined()
    expect(prisma).toHaveProperty('_isMockClient', true)
  })

  it('throws when DATABASE_URL is missing in web mode', async () => {
    delete process.env.ARCHE_RUNTIME_MODE
    delete process.env.DATABASE_URL

    await expect(import('../prisma')).rejects.toThrow('DATABASE_URL is required')
  })

  it('throws in desktop mode (not yet implemented)', async () => {
    process.env.ARCHE_RUNTIME_MODE = 'desktop'

    await expect(import('../prisma')).rejects.toThrow('Desktop Prisma client not yet implemented')
  })
})

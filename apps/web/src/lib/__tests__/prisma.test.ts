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
    // @ts-expect-error -- reset global for test isolation
    globalThis.prismaDesktopClient = undefined
  })

  afterEach(() => {
    process.env = originalEnv
    // @ts-expect-error -- reset global for test isolation
    globalThis.prisma = undefined
    // @ts-expect-error -- reset global for test isolation
    globalThis.prismaPool = undefined
    // @ts-expect-error -- reset global for test isolation
    globalThis.prismaDesktopClient = undefined
  })

  it('creates a PrismaClient in web mode', async () => {
    delete process.env.ARCHE_RUNTIME_MODE
    process.env.DATABASE_URL = 'postgresql://localhost/test'

    const { initWebPrisma, prisma } = await import('../prisma')
    await initWebPrisma()

    expect(prisma).toBeDefined()
    expect((prisma as unknown as { _isMockClient?: boolean })._isMockClient).toBe(true)
  })

  it('throws when DATABASE_URL is missing in web mode', async () => {
    delete process.env.ARCHE_RUNTIME_MODE
    delete process.env.DATABASE_URL

    const { initWebPrisma } = await import('../prisma')

    await expect(initWebPrisma()).rejects.toThrow('DATABASE_URL is required')
  })

  it('creates a desktop proxy in desktop mode', async () => {
    process.env.ARCHE_RUNTIME_MODE = 'desktop'

    const { prisma } = await import('../prisma')
    expect(prisma).toBeDefined()
    // The proxy is a real object but accessing model properties
    // throws because initDesktopPrisma() hasn't been called
    expect(() => prisma.user).toThrow('Desktop Prisma client not initialized')
  })

  it('desktop proxy works after initDesktopPrisma is called', async () => {
    process.env.ARCHE_RUNTIME_MODE = 'desktop'

    const mockClient = {
      user: { findMany: vi.fn() },
      $executeRawUnsafe: vi.fn(),
    }

    // Pre-set the global to simulate initDesktopPrisma() having run
    // @ts-expect-error -- setting global for test
    globalThis.prismaDesktopClient = mockClient

    const { prisma } = await import('../prisma')
    expect(prisma.user).toBe(mockClient.user)
  })

  it('initDesktopPrisma initializes the desktop client', async () => {
    process.env.ARCHE_RUNTIME_MODE = 'desktop'

    const mockClient = {
      $executeRawUnsafe: vi.fn(),
    }

    vi.doMock('@/lib/prisma-desktop', () => ({
      getDesktopPrismaClient: vi.fn().mockResolvedValue(mockClient),
      initDesktopDatabase: vi.fn().mockResolvedValue(undefined),
    }))

    const { initDesktopPrisma } = await import('../prisma')
    await initDesktopPrisma()

    expect(globalThis.prismaDesktopClient).toBe(mockClient)
  })
})

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const mockPrismaClient = vi.fn().mockImplementation(() => ({ _isMockClient: true }))
const mockPrismaPg = vi.fn()
const mockPool = vi.fn()

vi.mock('@prisma/client', () => ({
  PrismaClient: mockPrismaClient,
}))

vi.mock('@prisma/adapter-pg', () => ({
  PrismaPg: mockPrismaPg,
}))

vi.mock('pg', () => ({
  Pool: mockPool,
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
    process.env.ARCHE_DESKTOP_PLATFORM = 'darwin'
    process.env.ARCHE_DESKTOP_WEB_HOST = '127.0.0.1'

    const { prisma } = await import('../prisma')
    expect(prisma).toBeDefined()
    // The proxy is a real object but accessing model properties
    // throws because initDesktopPrisma() hasn't been called
    expect(() => prisma.user).toThrow('Desktop Prisma client not initialized')
  })

  it('desktop proxy works after initDesktopPrisma is called', async () => {
    process.env.ARCHE_RUNTIME_MODE = 'desktop'
    process.env.ARCHE_DESKTOP_PLATFORM = 'darwin'
    process.env.ARCHE_DESKTOP_WEB_HOST = '127.0.0.1'

    const mockClient = {
      user: { findMany: vi.fn() },
      $executeRawUnsafe: vi.fn(),
      $executeRaw: vi.fn(),
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
      $executeRaw: vi.fn(),
    }

    vi.doMock('@/lib/prisma-desktop', () => ({
      getDesktopPrismaClient: vi.fn().mockResolvedValue(mockClient),
      initDesktopDatabase: vi.fn().mockResolvedValue(undefined),
    }))

    const { initDesktopPrisma } = await import('../prisma-desktop-init')
    await initDesktopPrisma()

    expect(globalThis.prismaDesktopClient).toBe(mockClient)
  })

  it('initDesktopPrisma rejects if getDesktopPrismaClient throws', async () => {
    process.env.ARCHE_RUNTIME_MODE = 'desktop'

    vi.doMock('@/lib/prisma-desktop', () => ({
      getDesktopPrismaClient: vi.fn().mockRejectedValue(new Error('sqlite open failed')),
      initDesktopDatabase: vi.fn(),
    }))

    const { initDesktopPrisma } = await import('../prisma-desktop-init')
    await expect(initDesktopPrisma()).rejects.toThrow('sqlite open failed')
    expect(globalThis.prismaDesktopClient).toBeUndefined()
  })

  it('initDesktopPrisma does not expose the client if initDesktopDatabase fails', async () => {
    process.env.ARCHE_RUNTIME_MODE = 'desktop'

    const mockClient = { $executeRawUnsafe: vi.fn(), $executeRaw: vi.fn() }

    vi.doMock('@/lib/prisma-desktop', () => ({
      getDesktopPrismaClient: vi.fn().mockResolvedValue(mockClient),
      initDesktopDatabase: vi.fn().mockRejectedValue(new Error('DDL failed')),
    }))

    const { initDesktopPrisma } = await import('../prisma-desktop-init')
    await expect(initDesktopPrisma()).rejects.toThrow('DDL failed')
    expect(globalThis.prismaDesktopClient).toBeUndefined()
  })

  it('initDesktopPrisma exposes the client only after database init completes', async () => {
    process.env.ARCHE_RUNTIME_MODE = 'desktop'

    let resolveInit: () => void
    const databaseInitPromise = new Promise<void>((resolve) => {
      resolveInit = resolve
    })
    const mockClient = { $executeRawUnsafe: vi.fn(), $executeRaw: vi.fn() }
    const initDesktopDatabase = vi.fn().mockReturnValue(databaseInitPromise)

    vi.doMock('@/lib/prisma-desktop', () => ({
      getDesktopPrismaClient: vi.fn().mockResolvedValue(mockClient),
      initDesktopDatabase,
    }))

    const { initDesktopPrisma } = await import('../prisma-desktop-init')
    const init = initDesktopPrisma()

    while (initDesktopDatabase.mock.calls.length === 0) {
      await Promise.resolve()
    }

    expect(globalThis.prismaDesktopClient).toBeUndefined()
    resolveInit!()
    await init
    expect(globalThis.prismaDesktopClient).toBe(mockClient)
  })

  it('concurrent initDesktopPrisma calls share the same promise', async () => {
    process.env.ARCHE_RUNTIME_MODE = 'desktop'

    let resolveInit: () => void
    const initPromise = new Promise<void>((r) => { resolveInit = r })
    const mockClient = { $executeRawUnsafe: vi.fn(), $executeRaw: vi.fn() }

    vi.doMock('@/lib/prisma-desktop', () => ({
      getDesktopPrismaClient: vi.fn().mockImplementation(() => {
        return initPromise.then(() => mockClient)
      }),
      initDesktopDatabase: vi.fn().mockResolvedValue(undefined),
    }))

    const { initDesktopPrisma } = await import('../prisma-desktop-init')
    const p1 = initDesktopPrisma()
    const p2 = initDesktopPrisma()

    resolveInit!()
    await Promise.all([p1, p2])

    // getDesktopPrismaClient should only be called once
    const { getDesktopPrismaClient } = await import('@/lib/prisma-desktop')
    expect(getDesktopPrismaClient).toHaveBeenCalledTimes(1)
  })
})

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const mockExistsSync = vi.fn()
const mockMkdirSync = vi.fn()
const mockGetDesktopVaultRuntimeContext = vi.fn()
const mockPrismaBetterSqlite3 = vi.fn()
const mockGeneratedPrismaClient = vi.fn()

vi.mock('fs', () => ({
  existsSync: (...args: unknown[]) => mockExistsSync(...args),
  mkdirSync: (...args: unknown[]) => mockMkdirSync(...args),
}))

vi.mock('@/lib/runtime/desktop/context-store', () => ({
  getDesktopVaultRuntimeContext: (...args: unknown[]) => mockGetDesktopVaultRuntimeContext(...args),
}))

vi.mock('@prisma/adapter-better-sqlite3', () => ({
  PrismaBetterSqlite3: function PrismaBetterSqlite3(...args: unknown[]) {
    return mockPrismaBetterSqlite3(...args)
  },
}))

vi.mock('@/generated/prisma-desktop', () => ({
  PrismaClient: function PrismaClient(...args: unknown[]) {
    return mockGeneratedPrismaClient(...args)
  },
}))

describe('desktop prisma context isolation', () => {
  const originalEnv = process.env

  beforeEach(() => {
    vi.resetModules()
    vi.clearAllMocks()
    process.env = { ...originalEnv }
    delete process.env.DATABASE_URL
    process.env.ARCHE_DATA_DIR = '/tmp/active-vault'
    // @ts-expect-error test isolation
    globalThis.prismaDesktopClient = undefined

    mockGetDesktopVaultRuntimeContext.mockReturnValue(null)
    mockExistsSync.mockReturnValue(true)
    mockPrismaBetterSqlite3.mockImplementation(({ url }: { url: string }) => ({ url }))
    mockGeneratedPrismaClient.mockImplementation(({ adapter }: { adapter: { url: string } }) => ({
      adapterUrl: adapter.url,
      $executeRaw: vi.fn(),
      $executeRawUnsafe: vi.fn(),
      $queryRawUnsafe: vi.fn().mockResolvedValue([{ name: 'result_seen_at' }]),
      $queryRaw: vi.fn().mockResolvedValue([{ value: '1' }]),
    }))
  })

  afterEach(() => {
    process.env = originalEnv
    // @ts-expect-error test isolation
    globalThis.prismaDesktopClient = undefined
  })

  it('keeps contextual desktop clients isolated from the global client cache', async () => {
    const context = {
      databaseUrl: 'file:/tmp/context-vault/.arche.db',
      vaultRoot: '/tmp/context-vault',
    }

    mockGetDesktopVaultRuntimeContext.mockReturnValue(context)

    const { getDesktopPrismaClient } = await import('../prisma-desktop')
    const contextualClient = await getDesktopPrismaClient()

    expect(context.prismaClient).toBe(contextualClient)
    expect(contextualClient.adapterUrl).toBe('file:/tmp/context-vault/.arche.db')

    mockGetDesktopVaultRuntimeContext.mockReturnValue(null)

    const globalClient = await getDesktopPrismaClient()
    const repeatedGlobalClient = await getDesktopPrismaClient()

    expect(globalClient).not.toBe(contextualClient)
    expect(repeatedGlobalClient).toBe(globalClient)
    expect(globalClient.adapterUrl).toBe('file:/tmp/active-vault/.arche.db')
  })

  it('stores contextual init state without mutating the global desktop prisma client', async () => {
    const context = {
      databaseUrl: 'file:/tmp/context-vault/.arche.db',
      vaultRoot: '/tmp/context-vault',
    }

    mockGetDesktopVaultRuntimeContext.mockReturnValue(context)

    const { initDesktopPrisma } = await import('../prisma-desktop-init')
    await initDesktopPrisma()

    expect(context.prismaClient).toBeDefined()
    expect(globalThis.prismaDesktopClient).toBeUndefined()
  })

  it('adds the missing autopilot result_seen_at column during desktop init', async () => {
    const executeRawUnsafe = vi.fn()
    const queryRawUnsafe = vi.fn().mockResolvedValue([{ name: 'id' }])

    mockGeneratedPrismaClient.mockImplementationOnce(({ adapter }: { adapter: { url: string } }) => ({
      adapterUrl: adapter.url,
      $executeRaw: vi.fn(),
      $executeRawUnsafe: executeRawUnsafe,
      $queryRawUnsafe: queryRawUnsafe,
      $queryRaw: vi.fn().mockResolvedValue([{ value: '2' }]),
    }))

    const { initDesktopDatabase } = await import('../prisma-desktop')
    await initDesktopDatabase()

    expect(queryRawUnsafe).toHaveBeenCalledWith('PRAGMA table_info("autopilot_runs")')
    expect(executeRawUnsafe).toHaveBeenCalledWith(
      'ALTER TABLE "autopilot_runs" ADD COLUMN "result_seen_at" DATETIME',
    )
  })
})

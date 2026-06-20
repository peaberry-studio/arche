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
    globalThis.prismaDesktopClient = undefined
  })

  it('keeps contextual desktop clients isolated from the global client cache', async () => {
    const context: {
      databaseUrl: string
      vaultRoot: string
      prismaClient?: unknown
      prismaClientPromise?: Promise<unknown>
    } = {
      databaseUrl: 'file:/tmp/context-vault/.arche.db',
      vaultRoot: '/tmp/context-vault',
    }

    mockGetDesktopVaultRuntimeContext.mockReturnValue(context)

    const { getDesktopPrismaClient } = await import('../prisma-desktop')
    const contextualClient = await getDesktopPrismaClient()

    expect(context.prismaClient).toBeUndefined()
    expect(contextualClient.adapterUrl).toBe('file:/tmp/context-vault/.arche.db')

    mockGetDesktopVaultRuntimeContext.mockReturnValue(null)

    const globalClient = await getDesktopPrismaClient()
    const repeatedGlobalClient = await getDesktopPrismaClient()

    expect(globalClient).not.toBe(contextualClient)
    expect(repeatedGlobalClient).toBe(globalClient)
    expect(globalClient.adapterUrl).toBe('file:/tmp/active-vault/.arche.db')
  })

  it('prefers the active vault database over DATABASE_URL when both are present', async () => {
    process.env.DATABASE_URL = 'file:/tmp/external-dev-db.sqlite'

    const { getDesktopPrismaClient } = await import('../prisma-desktop')
    const client = await getDesktopPrismaClient()

    expect(client.adapterUrl).toBe('file:/tmp/active-vault/.arche.db')
  })

  it('stores contextual init state without mutating the global desktop prisma client', async () => {
    const context: {
      databaseUrl: string
      vaultRoot: string
      prismaClient?: unknown
      prismaClientPromise?: Promise<unknown>
    } = {
      databaseUrl: 'file:/tmp/context-vault/.arche.db',
      vaultRoot: '/tmp/context-vault',
    }

    mockGetDesktopVaultRuntimeContext.mockReturnValue(context)

    const { initDesktopPrisma } = await import('../prisma-desktop-init')
    await initDesktopPrisma()

    expect(context.prismaClient).toBeDefined()
    expect(globalThis.prismaDesktopClient).toBeUndefined()
  })

  it('drops legacy task tables during desktop init', async () => {
    const executeRawUnsafe = vi.fn()
    const queryRawUnsafe = vi.fn().mockResolvedValue([
      { name: 'kind' },
      { name: 'provider_sync_hash' },
      { name: 'provider_synced_at' },
    ])

    mockGeneratedPrismaClient.mockImplementationOnce(({ adapter }: { adapter: { url: string } }) => ({
      adapterUrl: adapter.url,
      $executeRaw: vi.fn(),
      $executeRawUnsafe: executeRawUnsafe,
      $queryRawUnsafe: queryRawUnsafe,
      $queryRaw: vi.fn().mockResolvedValue([{ value: '7' }]),
    }))

    const { initDesktopDatabase } = await import('../prisma-desktop')
    await initDesktopDatabase()

    const ddl = executeRawUnsafe.mock.calls.map((call) => String(call[0]))
    expect(ddl).toContain('DROP TABLE IF EXISTS "autopilot_runs"')
    expect(ddl).toContain('DROP TABLE IF EXISTS "autopilot_tasks"')
    expect(ddl.some((statement) => statement.includes('CREATE TABLE IF NOT EXISTS "autopilot_'))).toBe(false)
    expect(ddl.some((statement) => statement.includes('autopilot_tasks_'))).toBe(false)
  })

  it('executes the current desktop schema DDL including durable runs and Slack DM tables', async () => {
    const executeRawUnsafe = vi.fn()
    const queryRawUnsafe = vi.fn().mockResolvedValue([
      { name: 'kind' },
      { name: 'provider_sync_hash' },
      { name: 'provider_synced_at' },
      { name: 'slack_notification_config' },
      { name: 'retry_attempt' },
      { name: 'retry_scheduled_for' },
      { name: 'deleted_at' },
      { name: 'result_seen_at' },
      { name: 'attempt' },
    ])

    mockGeneratedPrismaClient.mockImplementationOnce(({ adapter }: { adapter: { url: string } }) => ({
      adapterUrl: adapter.url,
      $executeRaw: vi.fn(),
      $executeRawUnsafe: executeRawUnsafe,
      $queryRawUnsafe: queryRawUnsafe,
      $queryRaw: vi.fn().mockResolvedValue([{ value: '5' }]),
    }))

    const { initDesktopDatabase } = await import('../prisma-desktop')
    await initDesktopDatabase()

    const ddl = executeRawUnsafe.mock.calls.map((call) => String(call[0]))
    expect(ddl.some((statement) => statement.includes('CREATE TABLE IF NOT EXISTS "message_runs"'))).toBe(true)
    expect(ddl.some((statement) => statement.includes('CREATE TABLE IF NOT EXISTS "message_run_locks"'))).toBe(true)
    expect(ddl.some((statement) => statement.includes('CREATE TABLE IF NOT EXISTS "flows"'))).toBe(true)
    expect(ddl.some((statement) => statement.includes('"definition" TEXT NOT NULL'))).toBe(true)
    expect(ddl.some((statement) => statement.includes('CREATE TABLE IF NOT EXISTS "flow_runs"'))).toBe(true)
    expect(ddl.some((statement) => statement.includes('CREATE TABLE IF NOT EXISTS "flow_run_steps"'))).toBe(true)
    expect(ddl.some((statement) => statement.includes('"input" TEXT'))).toBe(true)
    expect(ddl.some((statement) => statement.includes('CREATE INDEX IF NOT EXISTS "message_runs_slug_opencode_session_id_status_idx"'))).toBe(true)
    expect(ddl.some((statement) => statement.includes('CREATE UNIQUE INDEX IF NOT EXISTS "message_run_locks_run_id_key"'))).toBe(true)
    expect(ddl.some((statement) => statement.includes('CREATE INDEX IF NOT EXISTS "flows_enabled_next_run_at_idx"'))).toBe(true)
    expect(ddl.some((statement) => statement.includes('CREATE UNIQUE INDEX IF NOT EXISTS "flow_runs_opencode_session_id_key"'))).toBe(true)
    expect(ddl.some((statement) => statement.includes('CREATE UNIQUE INDEX IF NOT EXISTS "flow_run_steps_run_id_node_id_key"'))).toBe(true)
    expect(ddl.some((statement) => statement.includes('CREATE TABLE IF NOT EXISTS "external_integrations"'))).toBe(true)
    expect(ddl.some((statement) => statement.includes('CREATE TABLE IF NOT EXISTS "slack_dm_session_bindings"'))).toBe(true)
    expect(ddl.some((statement) => statement.includes('"mcp_allowed" BOOLEAN NOT NULL DEFAULT false'))).toBe(true)
    expect(ddl.some((statement) => statement.includes('CREATE TABLE IF NOT EXISTS "mcp_settings"'))).toBe(true)
    expect(ddl.some((statement) => statement.includes('CREATE TABLE IF NOT EXISTS "personal_access_tokens"'))).toBe(true)
    expect(ddl.some((statement) => statement.includes('CREATE TABLE IF NOT EXISTS "rate_limit_buckets"'))).toBe(true)
    expect(ddl.some((statement) => statement.includes('CREATE UNIQUE INDEX IF NOT EXISTS "personal_access_tokens_lookup_hash_key"'))).toBe(true)
    expect(ddl.some((statement) => statement.includes('CREATE INDEX IF NOT EXISTS "rate_limit_buckets_reset_at_idx"'))).toBe(true)
    expect(ddl.some((statement) => statement.includes('CREATE TABLE IF NOT EXISTS "autopilot_'))).toBe(false)
    expect(ddl.some((statement) => statement.includes('JSONB'))).toBe(false)
  })

  it('adds mcp_allowed to existing desktop users tables', async () => {
    const executeRawUnsafe = vi.fn()
    const queryRawUnsafe = vi.fn()
      .mockResolvedValueOnce([{ name: 'kind' }])
      .mockResolvedValueOnce([{ name: 'kind' }])
      .mockResolvedValueOnce([{ name: 'provider_sync_hash' }, { name: 'provider_synced_at' }])
      .mockResolvedValueOnce([{ name: 'provider_sync_hash' }, { name: 'provider_synced_at' }])

    mockGeneratedPrismaClient.mockImplementationOnce(({ adapter }: { adapter: { url: string } }) => ({
      adapterUrl: adapter.url,
      $executeRaw: vi.fn(),
      $executeRawUnsafe: executeRawUnsafe,
      $queryRawUnsafe: queryRawUnsafe,
      $queryRaw: vi.fn().mockResolvedValue([{ value: '10' }]),
    }))

    const { initDesktopDatabase } = await import('../prisma-desktop')
    await initDesktopDatabase()

    const ddl = executeRawUnsafe.mock.calls.map((call) => String(call[0]))
    expect(ddl).toContain('ALTER TABLE "users" ADD COLUMN "mcp_allowed" BOOLEAN NOT NULL DEFAULT false')
  })
})

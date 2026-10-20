import Database from 'better-sqlite3'
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
    expect(ddl.filter((statement) => statement.includes('JSONB'))).toEqual([
      expect.stringContaining('CREATE TABLE IF NOT EXISTS "legacy_session_archives"'),
    ])
  })

  it('adds mcp_allowed to existing desktop users tables', async () => {
    const executeRawUnsafe = vi.fn()
    const queryRawUnsafe = vi.fn()
      .mockResolvedValueOnce([{ name: 'kind' }])
      .mockResolvedValueOnce([{ name: 'kind' }])
      .mockResolvedValueOnce([{ name: 'provider_sync_hash' }, { name: 'provider_synced_at' }])
      .mockResolvedValueOnce([{ name: 'provider_sync_hash' }, { name: 'provider_synced_at' }])
      .mockResolvedValueOnce([{ name: 'regeneration_change_id' }])
      .mockResolvedValueOnce([{ name: 'runtime_kind' }])

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

  it('adds regeneration_change_id to existing desktop learning runs tables', async () => {
    const executeRawUnsafe = vi.fn()
    const queryRawUnsafe = vi.fn()
      .mockResolvedValueOnce([{ name: 'kind' }, { name: 'mcp_allowed' }])
      .mockResolvedValueOnce([{ name: 'kind' }, { name: 'mcp_allowed' }])
      .mockResolvedValueOnce([{ name: 'provider_sync_hash' }, { name: 'provider_synced_at' }])
      .mockResolvedValueOnce([{ name: 'provider_sync_hash' }, { name: 'provider_synced_at' }])
      .mockResolvedValueOnce([{ name: 'id' }])
      .mockResolvedValueOnce([{ name: 'runtime_kind' }])

    mockGeneratedPrismaClient.mockImplementationOnce(({ adapter }: { adapter: { url: string } }) => ({
      adapterUrl: adapter.url,
      $executeRaw: vi.fn(),
      $executeRawUnsafe: executeRawUnsafe,
      $queryRawUnsafe: queryRawUnsafe,
      $queryRaw: vi.fn().mockResolvedValue([{ value: '11' }]),
    }))

    const { initDesktopDatabase } = await import('../prisma-desktop')
    await initDesktopDatabase()

    const ddl = executeRawUnsafe.mock.calls.map((call) => String(call[0]))
    expect(ddl).toContain('ALTER TABLE "knowledge_learning_runs" ADD COLUMN "regeneration_change_id" TEXT')
  })

  it.each(['fresh', 'upgrade'])('initializes an isolated %s SQLite database with runtime kind and owned archives', async (mode) => {
    const database = new Database(':memory:')
    database.pragma('foreign_keys = ON')

    try {
      if (mode === 'upgrade') {
        database.exec(`
          CREATE TABLE "instances" (
            "id" TEXT NOT NULL PRIMARY KEY,
            "slug" TEXT NOT NULL,
            "status" TEXT NOT NULL DEFAULT 'stopped',
            "created_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
            "started_at" DATETIME,
            "stopped_at" DATETIME,
            "last_activity_at" DATETIME,
            "container_id" TEXT,
            "server_password" TEXT NOT NULL,
            "applied_config_sha" TEXT,
            "provider_sync_hash" TEXT,
            "provider_synced_at" DATETIME,
            CONSTRAINT "instances_slug_fkey" FOREIGN KEY ("slug") REFERENCES "users" ("slug") ON DELETE RESTRICT ON UPDATE CASCADE
          );
          CREATE TABLE "_arche_schema_meta" ("key" TEXT NOT NULL PRIMARY KEY, "value" TEXT);
          INSERT INTO "_arche_schema_meta" VALUES ('schema_version', '12');
        `)
        database.pragma('foreign_keys = OFF')
        database.prepare('INSERT INTO instances (id, slug, status, container_id, server_password) VALUES (?, ?, ?, ?, ?)')
          .run('instance-1', 'alice', 'running', 'container-1', 'encrypted-password')
        database.pragma('foreign_keys = ON')
      }

      const client = {
        $executeRawUnsafe: (sql: string) => database.prepare(sql).run().changes,
        $queryRawUnsafe: (sql: string) => database.prepare(sql).all(),
        $executeRaw: (strings: TemplateStringsArray, ...values: string[]) => database.prepare(strings.join('?')).run(...values).changes,
        $queryRaw: (strings: TemplateStringsArray, ...values: string[]) => database.prepare(strings.join('?')).all(...values),
      }
      mockGetDesktopVaultRuntimeContext.mockReturnValue({ prismaClient: client })
      const { initDesktopDatabase } = await import('@/lib/prisma-desktop')

      await initDesktopDatabase()

      const insertUser = database.prepare('INSERT INTO users (id, email, slug, password_hash, updated_at) VALUES (?, ?, ?, ?, ?)')
      insertUser.run('user-1', 'alice@example.invalid', 'alice', 'test-hash', '2026-10-20T00:00:00Z')
      insertUser.run('user-2', 'bob@example.invalid', 'bob', 'test-hash', '2026-10-20T00:00:00Z')
      if (mode === 'fresh') {
        database.prepare('INSERT INTO instances (id, slug, status, container_id, server_password) VALUES (?, ?, ?, ?, ?)')
          .run('instance-1', 'alice', 'running', 'container-1', 'encrypted-password')
      }
      expect(database.prepare('SELECT id, slug, status, container_id, server_password, runtime_kind FROM instances').all()).toEqual([
        { id: 'instance-1', slug: 'alice', status: 'running', container_id: 'container-1', server_password: 'encrypted-password', runtime_kind: null },
      ])
      expect(database.prepare("SELECT value FROM _arche_schema_meta WHERE key = 'schema_version'").get()).toEqual({ value: '13' })

      const insertArchive = database.prepare(`INSERT INTO legacy_session_archives
        (id, slug, session_id, parent_id, title, created_at, updated_at, messages)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)`)
      const messages = JSON.stringify([{ id: 'message-1', parts: [] }])
      insertArchive.run('archive-1', 'alice', 'session-1', null, 'Title', '2026-10-19', '2026-10-20', messages)
      insertArchive.run('archive-2', 'bob', 'session-1', 'parent-1', 'Other title', '2026-10-19', '2026-10-20', '[]')
      expect(() => insertArchive.run('duplicate', 'alice', 'session-1', null, 'Title', '2026-10-19', '2026-10-20', '[]')).toThrow(/UNIQUE constraint failed/)
      expect(() => insertArchive.run('orphan', 'missing-owner', 'session-2', null, 'Title', '2026-10-19', '2026-10-20', '[]')).toThrow(/FOREIGN KEY constraint failed/)
      expect(database.prepare('SELECT messages, archived_at FROM legacy_session_archives WHERE id = ?').get('archive-1')).toEqual({
        messages,
        archived_at: expect.any(String),
      })

      await initDesktopDatabase()
      database.prepare('UPDATE users SET slug = ? WHERE id = ?').run('alice-renamed', 'user-1')
      expect(database.prepare('SELECT slug FROM legacy_session_archives WHERE id = ?').get('archive-1')).toEqual({ slug: 'alice-renamed' })
      database.prepare('DELETE FROM instances WHERE id = ?').run('instance-1')
      database.prepare('DELETE FROM users WHERE id = ?').run('user-1')
      expect(database.prepare('SELECT id FROM legacy_session_archives').all()).toEqual([{ id: 'archive-2' }])
      expect(database.pragma('foreign_key_check')).toEqual([])
    } finally {
      database.close()
    }
  })

  it('creates the knowledge review tables in the desktop DDL', async () => {
    const executeRawUnsafe = vi.fn()
    const queryRawUnsafe = vi.fn().mockResolvedValue([
      { name: 'kind' },
      { name: 'mcp_allowed' },
      { name: 'provider_sync_hash' },
      { name: 'provider_synced_at' },
      { name: 'regeneration_change_id' },
    ])

    mockGeneratedPrismaClient.mockImplementationOnce(({ adapter }: { adapter: { url: string } }) => ({
      adapterUrl: adapter.url,
      $executeRaw: vi.fn(),
      $executeRawUnsafe: executeRawUnsafe,
      $queryRawUnsafe: queryRawUnsafe,
      $queryRaw: vi.fn().mockResolvedValue([{ value: '11' }]),
    }))

    const { initDesktopDatabase } = await import('../prisma-desktop')
    await initDesktopDatabase()

    const ddl = executeRawUnsafe.mock.calls.map((call) => String(call[0]))
    expect(ddl.some((statement) => statement.includes('CREATE TABLE IF NOT EXISTS "knowledge_review_changes"'))).toBe(true)
    expect(ddl.some((statement) => statement.includes('CREATE TABLE IF NOT EXISTS "knowledge_learning_runs"'))).toBe(true)
    expect(ddl.some((statement) => statement.includes('"regeneration_change_id" TEXT'))).toBe(true)
    expect(ddl.some((statement) => statement.includes('CREATE UNIQUE INDEX IF NOT EXISTS "knowledge_review_changes_source_proposal_id_key"'))).toBe(true)
    expect(ddl.some((statement) => statement.includes('CREATE INDEX IF NOT EXISTS "knowledge_review_changes_user_id_kb_path_status_idx"'))).toBe(true)
    expect(ddl.some((statement) => statement.includes('CREATE INDEX IF NOT EXISTS "knowledge_learning_runs_regeneration_change_id_idx"'))).toBe(true)
  })
})

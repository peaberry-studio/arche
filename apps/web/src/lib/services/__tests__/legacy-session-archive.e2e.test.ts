import { PrismaBetterSqlite3 } from '@prisma/adapter-better-sqlite3'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { PrismaClient } from '@/generated/prisma-desktop'
import { fakeRuntime, message, session } from '@/lib/harness/__tests__/fake-runtime'
import type { HarnessSession } from '@/lib/harness/contract'
import { exportLegacySessions } from '@/lib/harness/legacy-session-archive'
import * as archive from '@/lib/services/legacy-session-archive'

const locks = vi.hoisted(() => ({
  desktop: true,
  owners: new Map<string, object>(),
  connections: [] as { lose: () => void; end: ReturnType<typeof vi.fn> }[],
}))
vi.mock('pg', () => ({ Client: class {
  private onError?: (error: Error) => void
  async connect() {}
  async query(sql: string, [key]: string[]) {
    expect(sql).toBe('SELECT pg_try_advisory_lock(hashtextextended($1, 0)) AS locked')
    expect(key).toBe(JSON.stringify(['harness-archive', 'alice']))
    const locked = !locks.owners.has(key)
    if (locked) locks.owners.set(key, this)
    return { rows: [{ locked }] }
  }
  end = vi.fn(async () => {
    for (const [key, owner] of locks.owners) if (owner === this) locks.owners.delete(key)
  })
  on(_event: string, callback: (error: Error) => void) { this.onError = callback }
  constructor() {
    locks.connections.push({ end: this.end, lose: () => { void this.end(); this.onError?.(new Error('lock_lost')) } })
  }
} }))

vi.mock('@/lib/prisma', () => ({ prisma: {
  get instance() { return client.instance },
  get legacySessionArchive() { return client.legacySessionArchive },
  $transaction: (callback: Parameters<PrismaClient['$transaction']>[0], options: object) => client.$transaction(callback, options),
} }))
vi.mock('@/lib/harness/registry', () => ({ getRuntimeForSlug: vi.fn() }))
vi.mock('@/lib/runtime/mode', () => ({ isDesktop: () => locks.desktop }))
vi.mock('@/lib/runtime/desktop/context-store', () => ({ getDesktopVaultRuntimeContext: () => ({ vaultRoot: process.cwd() }) }))

let client: PrismaClient

function sourceSession(id: string, parentId?: string): HarnessSession {
  return { ...session(id), title: `History ${id}`, parentId, createdAtRaw: 1_700_000_000_123, updatedAtRaw: 1_700_000_100_456 }
}

function sourceMessage(sessionId: string) {
  return message({
    id: `message-${sessionId}`, sessionId, content: 'Preserved reply', timestampRaw: 1_700_000_010_789,
    parts: [
      { type: 'text', id: 'text', text: 'Preserved reply' },
      { type: 'file', id: 'attachment', path: '.arche/attachments/report.csv', mime: 'text/csv', filename: 'report.csv' },
      { type: 'tool', id: 'tool', name: 'arche_tools_chart_create', state: { status: 'completed', input: { title: 'Report' }, output: '{"ok":true}', title: 'Chart', metadata: { rows: [1, 2] } } },
      { type: 'unknown', originalType: 'future-part', data: { preserved: true } },
    ],
  })
}

function sourceRuntime(sessions: HarnessSession[]) {
  const runtime = { ...fakeRuntime(), slug: 'alice' }
  runtime.listSessions.mockImplementation(async () => ({ ok: true, data: sessions.filter((item) => !item.parentId) }))
  runtime.listChildren.mockImplementation(async (id) => ({ ok: true, data: sessions.filter((item) => item.parentId === id) }))
  runtime.getSession.mockImplementation(async (id) => {
    const found = sessions.find((item) => item.id === id)
    return found ? { ok: true, data: found } : { ok: false, error: { code: 'session_not_found' } }
  })
  runtime.listMessages.mockImplementation(async (id) => ({ ok: true, data: [sourceMessage(id)] }))
  return runtime
}

describe('legacy archive export and SQLite storage', () => {
  beforeEach(async () => {
    locks.desktop = true
    locks.owners.clear()
    locks.connections.length = 0
    vi.stubEnv('DATABASE_URL', 'postgresql://localhost/test')
    client = new PrismaClient({ adapter: new PrismaBetterSqlite3({ url: ':memory:' }) })
    for (const sql of [
      'PRAGMA foreign_keys = ON',
      'CREATE TABLE users (id TEXT PRIMARY KEY, slug TEXT NOT NULL UNIQUE)',
      'CREATE TABLE audit_events (id TEXT PRIMARY KEY, actor_user_id TEXT, action TEXT NOT NULL, metadata JSONB, created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP)',
      "CREATE TABLE instances (id TEXT PRIMARY KEY, slug TEXT NOT NULL UNIQUE, runtime_kind TEXT, status TEXT NOT NULL DEFAULT 'running')",
      `CREATE TABLE legacy_session_archives (
        id TEXT PRIMARY KEY, slug TEXT NOT NULL, session_id TEXT NOT NULL, parent_id TEXT, title TEXT NOT NULL,
        created_at DATETIME NOT NULL, updated_at DATETIME NOT NULL, messages JSONB NOT NULL,
        archived_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
        validated_at DATETIME,
        UNIQUE (slug, session_id), FOREIGN KEY (slug) REFERENCES users(slug) ON DELETE CASCADE ON UPDATE CASCADE
      )`,
      "INSERT INTO users VALUES ('alice-id', 'alice'), ('bob-id', 'bob')",
      "INSERT INTO instances (id, slug, runtime_kind) VALUES ('alice-instance', 'alice', NULL), ('bob-instance', 'bob', 'opencode-v2')",
    ]) await client.$executeRawUnsafe(sql)
  })

  afterEach(async () => { await client.$disconnect(); vi.unstubAllEnvs(); vi.restoreAllMocks(); vi.useRealTimers() })

  it('preserves all 40 root/child conversations and parts across export, switch, repeat export and rollback', async () => {
    const sources = Array.from({ length: 20 }, (_, index) => [
      sourceSession(`root-${index}`), sourceSession(`child-${index}`, `root-${index}`),
    ]).flat()
    const runtime = sourceRuntime(sources)

    expect(await exportLegacySessions('alice', runtime)).toEqual({ ok: true, data: { archived: 40 } })
    expect(await client.legacySessionArchive.count()).toBe(40)
    expect(await archive.listSessions('alice')).toEqual([])
    expect(await archive.isArchivedSession('alice', 'root-0')).toBe(false)

    await client.instance.update({ where: { slug: 'alice' }, data: { runtimeKind: 'opencode-v2' }, select: { id: true } })
    expect(await archive.listSessions('alice')).toHaveLength(40)
    expect(await archive.findSession('alice', 'child-0')).toEqual({
      session: expect.objectContaining({ id: 'child-0', parentId: 'root-0', archived: true, updatedAtRaw: 1_700_000_100_456 }),
      messages: [sourceMessage('child-0')],
    })
    expect(await archive.findSession('bob', 'child-0')).toBeNull()
    expect(await archive.listSessions('bob')).toEqual([])
    expect(await archive.isArchivedSession('bob', 'child-0')).toBe(false)
    const stored = await client.legacySessionArchive.findMany({ orderBy: { sessionId: 'asc' } })
    expect(stored[0]).toMatchObject({ createdAt: new Date(1_700_000_000_123), updatedAt: new Date(1_700_000_100_456) })
    expect(await exportLegacySessions('alice', runtime)).toMatchObject({ ok: false, error: { code: 'session_busy' } })
    expect(await client.legacySessionArchive.findMany({ orderBy: { sessionId: 'asc' } })).toEqual(stored)

    await client.instance.update({ where: { slug: 'alice' }, data: { runtimeKind: 'opencode-v1' }, select: { id: true } })
    expect(await exportLegacySessions('alice', runtime)).toEqual({ ok: true, data: { archived: 0 } })
    expect(await archive.findSession('alice', 'child-0')).toBeNull()
    expect(await archive.listSessions('alice')).toEqual([])
    expect(await client.legacySessionArchive.count()).toBe(40)
    expect(runtime.deleteSession).not.toHaveBeenCalled()
    expect(runtime.prompt).not.toHaveBeenCalled()
  })

  it('resumes a failed export without duplicate rows and cascades only the deleted owner history', async () => {
    const runtime = sourceRuntime([sourceSession('root'), sourceSession('child', 'root')])
    runtime.listMessages.mockResolvedValueOnce({ ok: true, data: [sourceMessage('root')] })
      .mockResolvedValueOnce({ ok: false, error: { code: 'instance_unavailable' } })
    expect(await exportLegacySessions('alice', runtime)).toEqual({ ok: false, error: { code: 'instance_unavailable' } })
    expect(await client.legacySessionArchive.count()).toBe(1)
    expect(await archive.listSessions('alice')).toEqual([])

    const checkpoint = await client.legacySessionArchive.findUniqueOrThrow({ where: { slug_sessionId: { slug: 'alice', sessionId: 'root' } } })
    expect(checkpoint.validatedAt).toBeInstanceOf(Date)
    const freshReader = sourceRuntime([sourceSession('root'), sourceSession('child', 'root')])
    vi.resetModules()
    const retry = await import('@/lib/harness/legacy-session-archive')
    expect(await retry.exportLegacySessions('alice', freshReader)).toEqual({ ok: true, data: { archived: 1 } })
    expect(freshReader.listMessages).toHaveBeenCalledExactlyOnceWith('child', { signal: expect.any(AbortSignal) })
    expect(await client.legacySessionArchive.findUniqueOrThrow({ where: { slug_sessionId: { slug: 'alice', sessionId: 'root' } } })).toEqual(checkpoint)
    const sharedId = await client.legacySessionArchive.findUniqueOrThrow({ where: { slug_sessionId: { slug: 'alice', sessionId: 'root' } } })
    await archive.upsertSession({ ...sharedId, slug: 'bob', messages: [sourceMessage('root')] })
    expect(await client.legacySessionArchive.count()).toBe(3)

    await client.user.delete({ where: { slug: 'alice' }, select: { id: true } })
    expect(await client.legacySessionArchive.findMany()).toEqual([expect.objectContaining({ slug: 'bob', sessionId: 'root' })])
    expect(await archive.findSession('bob', 'root')).toMatchObject({ messages: [sourceMessage('root')] })
    expect(await client.$queryRawUnsafe('PRAGMA foreign_key_check')).toEqual([])
  })

  it('prunes out-of-band deletions only after final verification, including a completely empty inventory', async () => {
    const sources = [sourceSession('root'), sourceSession('child', 'root')]
    const runtime = sourceRuntime(sources)
    expect(await exportLegacySessions('alice', runtime)).toMatchObject({ ok: true })
    sources.splice(0)
    runtime.listSessions.mockResolvedValueOnce({ ok: false, error: { code: 'instance_unavailable' } })
    expect(await exportLegacySessions('alice', runtime)).toMatchObject({ ok: false })
    expect(await client.legacySessionArchive.count()).toBe(2)
    runtime.listSessions.mockResolvedValue({ ok: true, data: [] })
    expect(await exportLegacySessions('alice', runtime)).toEqual({ ok: true, data: { archived: 0 } })
    expect(await client.legacySessionArchive.count()).toBe(0)
  })

  it('releases the SQLite connection during runtime reads while serializing overlapping archive exports', async () => {
    const runtime = sourceRuntime([sourceSession('root')])
    const started = Promise.withResolvers<void>()
    const release = Promise.withResolvers<void>()
    runtime.listMessages.mockImplementationOnce(async (id) => {
      started.resolve()
      await release.promise
      return { ok: true, data: [sourceMessage(id)] }
    })
    const exporting = exportLegacySessions('alice', runtime)
    await started.promise
    const newer = sourceRuntime([{ ...sourceSession('root'), updatedAtRaw: 1_700_000_100_457 }])
    try {
      expect(await client.$transaction(async (tx) => tx.instance.count())).toBe(2)
      expect(await exportLegacySessions('alice', newer)).toMatchObject({ ok: false, error: { code: 'session_busy' } })
    } finally {
      release.resolve()
      await exporting
    }
    expect(await exporting).toMatchObject({ ok: true })
    expect(await exportLegacySessions('alice', newer)).toEqual({ ok: true, data: { archived: 1 } })
    expect(await archive.findExportedSession('alice', 'root')).toMatchObject({ updatedAt: new Date(1_700_000_100_457) })
  })

  it('keeps final inventory HTTP reads outside the reconciliation transaction', async () => {
    const runtime = sourceRuntime([])
    const started = Promise.withResolvers<void>()
    const release = Promise.withResolvers<void>()
    runtime.listSessions.mockResolvedValueOnce({ ok: true, data: [] }).mockImplementationOnce(async () => {
      started.resolve()
      await release.promise
      return { ok: true, data: [] }
    })
    const exporting = exportLegacySessions('alice', runtime)
    await started.promise
    try {
      expect(await client.$transaction(async (tx) => tx.instance.count())).toBe(2)
    } finally {
      release.resolve()
      await exporting
    }
    expect(await exporting).toEqual({ ok: true, data: { archived: 0 } })
  })

  it('never writes or prunes after losing the archive lock while an independent export completes', async () => {
    locks.desktop = false
    vi.resetModules()
    const other = await import('@/lib/harness/legacy-session-archive')
    const older = sourceRuntime([sourceSession('root')])
    const started = Promise.withResolvers<void>()
    const release = Promise.withResolvers<void>()
    older.listMessages.mockImplementationOnce(async (id) => {
      started.resolve()
      await release.promise
      return { ok: true, data: [sourceMessage(id)] }
    })
    const first = exportLegacySessions('alice', older)
    await started.promise
    const newer = sourceRuntime([{ ...sourceSession('root'), updatedAtRaw: 1_700_000_100_457 }, sourceSession('new')])
    try {
      expect(await other.exportLegacySessions('alice', newer)).toMatchObject({ ok: false, error: { code: 'session_busy' } })
      expect(newer.listSessions).not.toHaveBeenCalled()
      locks.connections[0].lose()
      expect(await other.exportLegacySessions('alice', newer)).toEqual({ ok: true, data: { archived: 2 } })
    } finally {
      release.resolve()
      await first
    }
    expect(await first).toMatchObject({ ok: false, error: { code: 'runtime_error', detail: expect.stringContaining('lock_lost') } })
    expect(await client.legacySessionArchive.count()).toBe(2)
    expect(await archive.findExportedSession('alice', 'root')).toMatchObject({ updatedAt: new Date(1_700_000_100_457) })
    expect(locks.owners.size).toBe(0)
    expect(await other.exportLegacySessions('alice', newer)).toEqual({ ok: true, data: { archived: 0 } })
  })

  it.each(['initial inventory', 'children', 'final inventory'])('releases a stalled %s read lock and discards late results after a retry', async (stage) => {
    locks.desktop = false
    vi.useFakeTimers()
    const timeout = vi.spyOn(AbortSignal, 'timeout').mockImplementation((ms) => {
      const controller = new AbortController()
      setTimeout(() => controller.abort(new Error('archive_read_timeout')), ms)
      return controller.signal
    })
    const older = sourceRuntime(stage === 'final inventory' ? [] : [sourceSession('root')])
    const started = Promise.withResolvers<void>()
    const release = Promise.withResolvers<void>()
    const stalled = async () => {
      started.resolve()
      await release.promise
      return { ok: true as const, data: stage === 'initial inventory' ? [sourceSession('root')] : [] }
    }
    if (stage === 'children') older.listChildren.mockImplementationOnce(stalled)
    else if (stage === 'final inventory') older.listSessions.mockResolvedValueOnce({ ok: true, data: [] }).mockImplementationOnce(stalled)
    else older.listSessions.mockImplementationOnce(stalled)

    let settled = false
    const first = exportLegacySessions('alice', older).then((result) => { settled = true; return result })
    await started.promise
    try {
      await vi.advanceTimersByTimeAsync(60_000)
      expect(settled).toBe(true)
      expect(await first).toMatchObject({ ok: false, error: { code: 'runtime_error', detail: expect.stringContaining('archive_read_timeout') } })
      expect(locks.owners.size).toBe(0)
      timeout.mockRestore()
      vi.useRealTimers()
      const newer = sourceRuntime([{ ...sourceSession('root'), updatedAtRaw: 1_700_000_100_457 }, sourceSession('new')])
      expect(await exportLegacySessions('alice', newer)).toEqual({ ok: true, data: { archived: 2 } })
    } finally {
      release.resolve()
      await first
    }
    expect(await client.legacySessionArchive.count()).toBe(2)
    expect(await archive.findExportedSession('alice', 'root')).toMatchObject({ updatedAt: new Date(1_700_000_100_457) })
  })
})

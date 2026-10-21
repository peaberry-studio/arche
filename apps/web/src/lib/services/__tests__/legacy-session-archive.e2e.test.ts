import { PrismaBetterSqlite3 } from '@prisma/adapter-better-sqlite3'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { PrismaClient } from '@/generated/prisma-desktop'
import { fakeRuntime, message, session } from '@/lib/harness/__tests__/fake-runtime'
import type { HarnessSession } from '@/lib/harness/contract'
import { exportLegacySessions } from '@/lib/harness/legacy-session-archive'
import * as archive from '@/lib/services/legacy-session-archive'

vi.mock('@/lib/prisma', () => ({ prisma: {
  get instance() { return client.instance },
  get legacySessionArchive() { return client.legacySessionArchive },
  $transaction: (callback: Parameters<PrismaClient['$transaction']>[0], options: object) => client.$transaction(callback, options),
} }))
vi.mock('@/lib/harness/registry', () => ({ getRuntimeForSlug: vi.fn() }))

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
        UNIQUE (slug, session_id), FOREIGN KEY (slug) REFERENCES users(slug) ON DELETE CASCADE ON UPDATE CASCADE
      )`,
      "INSERT INTO users VALUES ('alice-id', 'alice'), ('bob-id', 'bob')",
      "INSERT INTO instances (id, slug, runtime_kind) VALUES ('alice-instance', 'alice', NULL), ('bob-instance', 'bob', 'opencode-v2')",
    ]) await client.$executeRawUnsafe(sql)
  })

  afterEach(async () => { await client.$disconnect() })

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

    expect(await exportLegacySessions('alice', runtime)).toEqual({ ok: true, data: { archived: 1 } })
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
})

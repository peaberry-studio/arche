import type { LegacySessionArchive } from '@prisma/client'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const { mockPrisma, mockTransaction } = vi.hoisted(() => ({
  mockPrisma: {
    instance: { findUnique: vi.fn(), findFirst: vi.fn() },
    legacySessionArchive: { findUnique: vi.fn(), findMany: vi.fn(), upsert: vi.fn() },
    $transaction: vi.fn(),
  },
  mockTransaction: {
    instance: { updateMany: vi.fn() },
    legacySessionArchive: { upsert: vi.fn(), findMany: vi.fn(), deleteMany: vi.fn() },
  },
}))

vi.mock('@/lib/prisma', () => ({ prisma: mockPrisma }))

import { formatTimestamp } from '@/lib/format-timestamp'
import {
  findExportedSession,
  findNextRunningV1Instance,
  findSession,
  isArchivedSession,
  listSessions,
  reconcileSessions,
  upsertSession,
  withArchiveWriteFence,
} from '@/lib/services/legacy-session-archive'

const record: LegacySessionArchive = {
  id: 'archive-1', slug: 'alice', sessionId: 'session-1', parentId: 'parent-1', title: 'History',
  createdAt: new Date(1_700_000_000_123), updatedAt: new Date(1_700_000_100_456), archivedAt: new Date(),
  messages: [{ id: 'message-1', sessionId: 'session-1', role: 'assistant', content: 'Hello', timestamp: 'then', timestampRaw: 1_700_000_010_789, parts: [{ type: 'text', text: 'Hello' }] }],
}

const snapshot: Parameters<typeof upsertSession>[0] = {
  slug: 'alice', sessionId: 'session-1', title: 'History', parentId: null,
  createdAt: record.createdAt, updatedAt: record.updatedAt,
  messages: [{ id: 'message-1', sessionId: 'session-1', role: 'assistant', content: 'Complete reply', timestamp: 'then', parts: [] }],
}

beforeEach(() => {
  vi.resetAllMocks()
  mockPrisma.instance.findUnique.mockResolvedValue({ runtimeKind: 'opencode-v2' })
  mockPrisma.legacySessionArchive.findUnique.mockImplementation(async ({ where }) =>
    where.slug_sessionId.slug === record.slug && where.slug_sessionId.sessionId === record.sessionId ? record : null)
  mockPrisma.legacySessionArchive.findMany.mockImplementation(async ({ where }) => where.slug === record.slug ? [record] : [])
  mockPrisma.$transaction.mockImplementation(async (callback: (tx: typeof mockTransaction) => Promise<boolean>) => callback(mockTransaction))
  mockTransaction.instance.updateMany.mockResolvedValue({ count: 1 })
})

describe('archive reads', () => {
  it('returns a read-only session and preserves every message and raw timestamp', async () => {
    expect(await findSession('alice', 'session-1')).toEqual({
      session: {
        id: 'session-1', title: 'History', parentId: 'parent-1', status: 'idle', archived: true,
        updatedAt: formatTimestamp(record.updatedAt.getTime()), updatedAtRaw: record.updatedAt.getTime(),
      },
      messages: record.messages,
    })
    expect(await isArchivedSession('alice', 'session-1')).toBe(true)
    expect(await listSessions('alice')).toEqual([expect.objectContaining({ id: 'session-1', archived: true })])
  })

  it.each([null, { runtimeKind: null }, { runtimeKind: 'opencode-v1' }])('hides prearchives and rollback history for instance %j', async (instance) => {
    mockPrisma.instance.findUnique.mockResolvedValue(instance)
    expect(await findSession('alice', 'session-1')).toBeNull()
    expect(await listSessions('alice')).toEqual([])
    expect(await isArchivedSession('alice', 'session-1')).toBe(false)
    expect(mockPrisma.legacySessionArchive.findUnique).not.toHaveBeenCalled()
    expect(mockPrisma.legacySessionArchive.findMany).not.toHaveBeenCalled()
  })

  it('hides archives again immediately after rolling back to v1', async () => {
    expect(await isArchivedSession('alice', 'session-1')).toBe(true)
    mockPrisma.instance.findUnique.mockResolvedValue({ runtimeKind: 'opencode-v1' })
    expect(await isArchivedSession('alice', 'session-1')).toBe(false)
  })

  it('never returns another workspace owner’s archive even for the same session id', async () => {
    expect(await findSession('bob', 'session-1')).toBeNull()
    expect(await listSessions('bob')).toEqual([])
    expect(await isArchivedSession('bob', 'session-1')).toBe(false)
    expect(await findExportedSession('bob', 'session-1')).toBeNull()
    expect(mockPrisma.legacySessionArchive.findUnique).toHaveBeenCalledWith(expect.objectContaining({
      where: { slug_sessionId: { slug: 'bob', sessionId: 'session-1' } },
    }))
  })

  it('does not fetch message payloads when listing sessions', async () => {
    await listSessions('alice')
    expect(mockPrisma.legacySessionArchive.findMany).toHaveBeenCalledWith({
      where: { slug: 'alice' },
      select: { id: true, slug: true, sessionId: true, parentId: true, title: true, createdAt: true, updatedAt: true, archivedAt: true },
      orderBy: [{ updatedAt: 'desc' }, { sessionId: 'asc' }],
    })
  })

  it('returns null for a missing session', async () => {
    expect(await findSession('alice', 'missing')).toBeNull()
  })
})

describe('export storage', () => {
  it.each([false, true])('locks the owner V1 row before invoking archive work (running only: %s)', async (onlyWhileRunning) => {
    const work = vi.fn(async () => 'done')
    expect(await withArchiveWriteFence('alice', work, { onlyWhileRunning })).toBe('done')
    expect(mockTransaction.instance.updateMany).toHaveBeenCalledExactlyOnceWith({
      where: { slug: 'alice', ...(onlyWhileRunning ? { status: 'running' } : {}), OR: [{ runtimeKind: null }, { runtimeKind: 'opencode-v1' }] },
      data: { slug: 'alice' },
    })
    expect(work).toHaveBeenCalledWith(mockTransaction)
    expect(mockTransaction.instance.updateMany.mock.invocationCallOrder[0]).toBeLessThan(work.mock.invocationCallOrder[0])
    expect(mockPrisma.$transaction).toHaveBeenCalledWith(expect.any(Function), { maxWait: 10_000, timeout: 60_000 })
  })

  it('does not invoke fenced work without a matching owner/V1 row', async () => {
    mockTransaction.instance.updateMany.mockResolvedValue({ count: 0 })
    const work = vi.fn()
    expect(await withArchiveWriteFence('alice', work)).toBeNull()
    expect(work).not.toHaveBeenCalled()
  })

  it('holds the row fence until work finishes and propagates failures', async () => {
    let finish!: () => void
    let started!: () => void
    const pending = new Promise<void>((resolve) => { finish = resolve })
    const ready = new Promise<void>((resolve) => { started = resolve })
    const committed = vi.fn()
    mockPrisma.$transaction.mockImplementation(async (callback) => {
      const result = await callback(mockTransaction)
      committed()
      return result
    })
    const work = withArchiveWriteFence('alice', async () => { started(); await pending; return 'done' })
    await ready
    expect(committed).not.toHaveBeenCalled()
    finish()
    expect(await work).toBe('done')
    expect(committed).toHaveBeenCalledOnce()
    await expect(withArchiveWriteFence('alice', async () => { throw new Error('failed') })).rejects.toThrow('failed')
    expect(committed).toHaveBeenCalledOnce()
  })

  it.each([{ ids: [] }, { ids: ['root', 'child'] }])('reconciles only the owner rows absent from inventory %j', async ({ ids }) => {
    await withArchiveWriteFence('alice', (tx) => reconcileSessions('alice', ids, tx))
    expect(mockTransaction.legacySessionArchive.deleteMany).toHaveBeenCalledWith({
      where: { slug: 'alice', sessionId: { notIn: ids } },
    })
  })

  it('fences background writes with an owner-scoped running-V1 row update inside the archive transaction', async () => {
    expect(await upsertSession(snapshot, { onlyWhileRunning: true })).toBe(true)
    expect(mockPrisma.$transaction).toHaveBeenCalledTimes(1)
    expect(mockTransaction.instance.updateMany).toHaveBeenCalledWith({
      where: { slug: 'alice', status: 'running', OR: [{ runtimeKind: null }, { runtimeKind: 'opencode-v1' }] },
      data: { status: 'running' },
    })
    expect(mockTransaction.instance.updateMany.mock.invocationCallOrder[0]).toBeLessThan(mockTransaction.legacySessionArchive.upsert.mock.invocationCallOrder[0])
    expect(mockTransaction.legacySessionArchive.upsert).toHaveBeenCalledWith(expect.objectContaining({
      where: { slug_sessionId: { slug: 'alice', sessionId: 'session-1' } },
      update: expect.objectContaining({ messages: snapshot.messages }),
    }))
    expect(mockPrisma.legacySessionArchive.upsert).not.toHaveBeenCalled()
  })

  it.each([
    { status: 'starting', runtimeKind: 'opencode-v1' },
    { status: 'stopped', runtimeKind: null },
    { status: 'running', runtimeKind: 'opencode-v2' },
    { status: 'running', runtimeKind: 'unknown' },
    null,
  ])('skips a background write after the instance leaves running V1: %j', async (instance) => {
    mockTransaction.instance.updateMany.mockImplementation(async () => ({
      count: instance?.status === 'running' && (instance.runtimeKind === null || instance.runtimeKind === 'opencode-v1') ? 1 : 0,
    }))
    expect(await upsertSession(snapshot, { onlyWhileRunning: true })).toBe(false)
    expect(mockTransaction.legacySessionArchive.upsert).not.toHaveBeenCalled()
    expect(mockPrisma.legacySessionArchive.upsert).not.toHaveBeenCalled()
  })

  it('holds the transaction open until its guarded archive write finishes', async () => {
    let finishWrite: (() => void) | undefined
    let writeStarted: (() => void) | undefined
    const started = new Promise<void>((resolve) => { writeStarted = resolve })
    const write = new Promise<void>((resolve) => { finishWrite = resolve })
    const committed = vi.fn()
    mockPrisma.$transaction.mockImplementation(async (callback: (tx: typeof mockTransaction) => Promise<boolean>) => {
      const result = await callback(mockTransaction)
      committed()
      return result
    })
    mockTransaction.legacySessionArchive.upsert.mockImplementation(async () => {
      writeStarted!()
      await write
    })

    const saving = upsertSession(snapshot, { onlyWhileRunning: true })
    await started
    expect(committed).not.toHaveBeenCalled()
    finishWrite!()
    expect(await saving).toBe(true)
    expect(committed).toHaveBeenCalledTimes(1)
  })

  it('allows final export writes while migration owns the starting instance', async () => {
    mockTransaction.instance.updateMany.mockResolvedValue({ count: 0 })
    expect(await upsertSession(snapshot)).toBe(true)
    expect(mockPrisma.$transaction).not.toHaveBeenCalled()
    expect(mockTransaction.instance.updateMany).not.toHaveBeenCalled()
    expect(mockPrisma.legacySessionArchive.upsert).toHaveBeenCalledWith(expect.objectContaining({
      where: { slug_sessionId: { slug: 'alice', sessionId: 'session-1' } },
    }))
  })

  it('does not permit a late background snapshot to overwrite the final migration snapshot', async () => {
    let migrated = false
    let savedMessages = snapshot.messages
    mockTransaction.instance.updateMany.mockImplementation(async () => ({ count: migrated ? 0 : 1 }))
    mockPrisma.legacySessionArchive.upsert.mockImplementation(async ({ update }) => { savedMessages = update.messages })
    mockTransaction.legacySessionArchive.upsert.mockImplementation(async ({ update }) => { savedMessages = update.messages })

    migrated = true
    await upsertSession(snapshot)
    const stale = { ...snapshot, messages: [{ ...snapshot.messages[0], content: 'Older background reply' }] }
    expect(await upsertSession(stale, { onlyWhileRunning: true })).toBe(false)
    expect(savedMessages).toEqual(snapshot.messages)
  })

  it('propagates guarded transaction failures instead of reporting a stored snapshot', async () => {
    mockTransaction.legacySessionArchive.upsert.mockRejectedValue(new Error('write failed'))
    await expect(upsertSession(snapshot, { onlyWhileRunning: true })).rejects.toThrow('write failed')
  })

  it('can check exported metadata while the instance remains v1', async () => {
    mockPrisma.instance.findUnique.mockResolvedValue({ runtimeKind: 'opencode-v1' })
    expect(await findExportedSession('alice', 'session-1')).toEqual(record)
    expect(mockPrisma.instance.findUnique).not.toHaveBeenCalled()
    expect(mockPrisma.legacySessionArchive.findUnique).toHaveBeenCalledWith({
      where: { slug_sessionId: { slug: 'alice', sessionId: 'session-1' } },
      select: { title: true, parentId: true, createdAt: true, updatedAt: true, messages: true },
    })
  })

  it('upserts on owner and session, preserving source dates and message parts', async () => {
    const input = {
      slug: 'alice', sessionId: 'session-1', title: 'History', parentId: null,
      createdAt: record.createdAt, updatedAt: record.updatedAt,
      messages: [{ id: 'message-1', sessionId: 'session-1', role: 'assistant' as const, content: 'Hello', timestamp: 'then', timestampRaw: 1_700_000_010_789, parts: [{ type: 'text' as const, text: 'Hello' }], pending: undefined }],
    }
    await upsertSession(input)
    const data = {
      title: input.title, parentId: null, createdAt: input.createdAt, updatedAt: input.updatedAt,
      messages: JSON.parse(JSON.stringify(input.messages)), archivedAt: expect.any(Date),
    }
    expect(mockPrisma.legacySessionArchive.upsert).toHaveBeenCalledWith({
      where: { slug_sessionId: { slug: 'alice', sessionId: 'session-1' } },
      create: { slug: 'alice', sessionId: 'session-1', ...data }, update: data,
    })
  })

  it('selects only running null/v1 instances and rotates through workspaces', async () => {
    mockPrisma.instance.findFirst.mockResolvedValueOnce(null).mockResolvedValueOnce({ slug: 'alice' })
    expect(await findNextRunningV1Instance('zoe')).toEqual({ slug: 'alice' })
    const where = { status: 'running', OR: [{ runtimeKind: null }, { runtimeKind: 'opencode-v1' }] }
    expect(mockPrisma.instance.findFirst).toHaveBeenNthCalledWith(1, {
      where: { ...where, slug: { gt: 'zoe' } }, select: { slug: true }, orderBy: { slug: 'asc' },
    })
    expect(mockPrisma.instance.findFirst).toHaveBeenNthCalledWith(2, {
      where, select: { slug: true }, orderBy: { slug: 'asc' },
    })
  })
})

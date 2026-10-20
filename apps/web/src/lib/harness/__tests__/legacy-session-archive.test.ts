import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { fakeRuntime, message, session } from '@/lib/harness/__tests__/fake-runtime'
import type { HarnessSession } from '@/lib/harness/contract'
import { harnessFailure } from '@/lib/harness/errors'
import type { ExportedSessionMetadata } from '@/lib/services/legacy-session-archive'
import type { WorkspaceMessage } from '@/types/workspace-runtime'

vi.mock('@/lib/services/legacy-session-archive', () => ({
  findExportedSession: vi.fn(), upsertSession: vi.fn(), findNextRunningV1Instance: vi.fn(),
}))
vi.mock('@/lib/harness/registry', () => ({ getRuntimeForSlug: vi.fn() }))

import { exportLegacySessions } from '@/lib/harness/legacy-session-archive'
import { getRuntimeForSlug } from '@/lib/harness/registry'
import * as storage from '@/lib/services/legacy-session-archive'

const mockStorage = vi.mocked(storage)
const mockGetRuntime = vi.mocked(getRuntimeForSlug)

function legacySession(id: string, parentId?: string): HarnessSession {
  return { ...session(id), title: id, parentId, createdAtRaw: 1_700_000_000_123, updatedAtRaw: 1_700_000_100_456 }
}

let exported: Map<string, ExportedSessionMetadata & { messages: WorkspaceMessage[] }>
let runtime: ReturnType<typeof fakeRuntime>

beforeEach(() => {
  vi.resetAllMocks()
  exported = new Map()
  runtime = fakeRuntime()
  runtime.getSession.mockImplementation(async (id) => {
    const listing = runtime.listSessions.mock.results.at(-1)
    const listed = listing?.type === 'return' ? await listing.value : undefined
    const children = await Promise.all(runtime.listChildren.mock.results.flatMap((result) => result.type === 'return' ? [result.value] : []))
    const source = [...(listed?.ok ? listed.data : []), ...children.flatMap((result) => result.ok ? result.data : [])].find((source) => source.id === id)
    return source ? { ok: true, data: source } : harnessFailure('session_not_found')
  })
  runtime.listMessages.mockImplementation(async (sessionId) => ({ ok: true, data: [message({ sessionId, timestampRaw: 1_700_000_050_789 })] }))
  mockStorage.findExportedSession.mockImplementation(async (slug, id) => exported.get(`${slug}/${id}`) ?? null)
  mockStorage.upsertSession.mockImplementation(async (input) => {
    exported.set(`${input.slug}/${input.sessionId}`, input)
    return true
  })
  mockGetRuntime.mockResolvedValue({ ok: true, data: runtime })
})

afterEach(() => {
  vi.restoreAllMocks()
  vi.useRealTimers()
})

describe('exportLegacySessions', () => {
  it('archives roots and recursive children, preserving timestamps and parts', async () => {
    runtime.listSessions.mockResolvedValue({ ok: true, data: [legacySession('root'), legacySession('other')] })
    runtime.listChildren.mockImplementation(async (id) => ({ ok: true, data: id === 'root' ? [legacySession('child', 'root')] : id === 'child' ? [legacySession('grandchild', 'child')] : [] }))

    expect(await exportLegacySessions(runtime.slug, runtime)).toEqual({ ok: true, data: { archived: 4 } })
    expect(runtime.listSessions).toHaveBeenCalledWith({ rootsOnly: false, limit: Number.MAX_SAFE_INTEGER })
    expect(mockStorage.upsertSession).toHaveBeenCalledWith(expect.objectContaining({
      slug: runtime.slug, sessionId: 'grandchild', parentId: 'child',
      createdAt: new Date(1_700_000_000_123), updatedAt: new Date(1_700_000_100_456),
      messages: [expect.objectContaining({ sessionId: 'grandchild', timestampRaw: 1_700_000_050_789, parts: [{ type: 'text', id: 'part-1', text: 'Done' }] })],
    }))
    expect(runtime.listMessages).toHaveBeenCalledTimes(4)
  })

  it('traverses children even when their parent is already exported', async () => {
    const root = legacySession('root')
    exported.set(`${runtime.slug}/root`, { title: root.title, parentId: null, createdAt: new Date(root.createdAtRaw!), updatedAt: new Date(root.updatedAtRaw!), messages: [message({ sessionId: 'root', timestampRaw: 1_700_000_050_789 })] })
    runtime.listSessions.mockResolvedValue({ ok: true, data: [root] })
    runtime.listChildren.mockImplementation(async (id) => ({ ok: true, data: id === 'root' ? [legacySession('child', 'root')] : [] }))
    expect(await exportLegacySessions(runtime.slug, runtime)).toEqual({ ok: true, data: { archived: 1 } })
    expect(runtime.listMessages).toHaveBeenCalledTimes(2)
    expect(mockStorage.upsertSession).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({ sessionId: 'child' }))
  })

  it('resumes a partial export without rewriting unchanged snapshots', async () => {
    runtime.listSessions.mockResolvedValue({ ok: true, data: [legacySession('first'), legacySession('second')] })
    runtime.listMessages.mockImplementation(async (id) => id === 'second' ? harnessFailure('runtime_error', 'connection lost') : { ok: true, data: [message({ sessionId: id })] })
    expect(await exportLegacySessions(runtime.slug, runtime)).toEqual(harnessFailure('runtime_error', 'connection lost'))
    expect(exported.size).toBe(1)

    runtime.listMessages.mockClear().mockImplementation(async (id) => ({ ok: true, data: [message({ sessionId: id })] }))
    expect(await exportLegacySessions(runtime.slug, runtime)).toEqual({ ok: true, data: { archived: 1 } })
    expect(runtime.listMessages).toHaveBeenCalledTimes(2)
    expect(mockStorage.upsertSession).toHaveBeenCalledTimes(2)
    expect(exported.size).toBe(2)
  })

  it('refreshes active history when the source timestamp changes', async () => {
    const source = legacySession('active')
    runtime.listSessions.mockResolvedValue({ ok: true, data: [source] })
    await exportLegacySessions(runtime.slug, runtime)
    runtime.listSessions.mockResolvedValue({ ok: true, data: [{ ...source, updatedAtRaw: source.updatedAtRaw! + 1 }] })
    runtime.listMessages.mockResolvedValue({ ok: true, data: [message({ sessionId: 'active', content: 'New reply' })] })
    expect(await exportLegacySessions(runtime.slug, runtime)).toEqual({ ok: true, data: { archived: 1 } })
    expect(mockStorage.upsertSession).toHaveBeenLastCalledWith(expect.objectContaining({ messages: [expect.objectContaining({ content: 'New reply' })] }))
    expect(await exportLegacySessions(runtime.slug, runtime)).toEqual({ ok: true, data: { archived: 0 } })
  })

  it('replaces an older incomplete prearchive even if session metadata never changed', async () => {
    const source = legacySession('active')
    exported.set(`${runtime.slug}/active`, {
      title: source.title, parentId: null, createdAt: new Date(source.createdAtRaw!), updatedAt: new Date(source.updatedAtRaw!),
      messages: [message({ sessionId: 'active', content: 'Partial reply' })],
    })
    runtime.listSessions.mockResolvedValue({ ok: true, data: [source] })
    runtime.listMessages.mockResolvedValue({ ok: true, data: [message({ sessionId: 'active', content: 'Complete reply', completedAt: 1_700_000_100_456 })] })

    expect(await exportLegacySessions(runtime.slug, runtime)).toEqual({ ok: true, data: { archived: 1 } })
    expect(exported.get(`${runtime.slug}/active`)?.messages).toEqual([expect.objectContaining({ content: 'Complete reply', completedAt: 1_700_000_100_456 })])
    expect(await exportLegacySessions(runtime.slug, runtime)).toEqual({ ok: true, data: { archived: 0 } })
    expect(mockStorage.upsertSession).toHaveBeenCalledTimes(1)
  })

  it.each(['busy', 'retry', 'unknown'] as const)('fails closed when status is %s before reading messages', async (type) => {
    runtime.listSessions.mockResolvedValue({ ok: true, data: [legacySession('active')] })
    runtime.sessionStatus.mockResolvedValue({ ok: true, data: { active: { type } } })
    expect(await exportLegacySessions(runtime.slug, runtime)).toMatchObject({ ok: false, error: { code: 'session_busy' } })
    expect(runtime.listMessages).not.toHaveBeenCalled()
    expect(mockStorage.upsertSession).not.toHaveBeenCalled()
  })

  it.each(['busy', 'retry', 'unknown'] as const)('does not persist a snapshot if status changes to %s during the read', async (type) => {
    runtime.listSessions.mockResolvedValue({ ok: true, data: [legacySession('active')] })
    runtime.sessionStatus.mockResolvedValueOnce({ ok: true, data: {} }).mockResolvedValueOnce({ ok: true, data: { active: { type } } })
    expect(await exportLegacySessions(runtime.slug, runtime)).toMatchObject({ ok: false, error: { code: 'session_busy' } })
    expect(runtime.listMessages).toHaveBeenCalledExactlyOnceWith('active')
    expect(mockStorage.upsertSession).not.toHaveBeenCalled()
  })

  it.each([
    { updatedAtRaw: 1_700_000_100_457 }, { createdAtRaw: 1_700_000_000_124 },
    { title: 'Renamed during read' }, { parentId: 'new-parent' },
  ])('rejects a snapshot when getSession detects changed metadata %j', async (change) => {
    const source = legacySession('active')
    runtime.listSessions.mockResolvedValue({ ok: true, data: [source] })
    runtime.getSession.mockResolvedValue({ ok: true, data: { ...source, ...change } })
    expect(await exportLegacySessions(runtime.slug, runtime)).toMatchObject({ ok: false, error: { code: 'session_busy' } })
    expect(runtime.listMessages).toHaveBeenCalledExactlyOnceWith('active')
    expect(mockStorage.upsertSession).not.toHaveBeenCalled()
  })

  it('propagates failed metadata rechecks instead of persisting an unverified snapshot', async () => {
    runtime.listSessions.mockResolvedValue({ ok: true, data: [legacySession('active')] })
    runtime.getSession.mockResolvedValue(harnessFailure('instance_unavailable'))
    expect(await exportLegacySessions(runtime.slug, runtime)).toEqual(harnessFailure('instance_unavailable'))
    expect(mockStorage.upsertSession).not.toHaveBeenCalled()
  })

  it.each([false, true])('propagates status errors (after read: %s)', async (afterRead) => {
    runtime.listSessions.mockResolvedValue({ ok: true, data: [legacySession('active')] })
    if (afterRead) runtime.sessionStatus.mockResolvedValueOnce({ ok: true, data: {} })
    runtime.sessionStatus.mockResolvedValue(harnessFailure('instance_unavailable'))
    expect(await exportLegacySessions(runtime.slug, runtime)).toEqual(harnessFailure('instance_unavailable'))
    expect(mockStorage.upsertSession).not.toHaveBeenCalled()
  })

  it.each([{ title: 'Renamed' }, { parentId: 'new-parent' }, { createdAtRaw: 1_600_000_000_000 }])('refreshes changed metadata %j even if updatedAt is unchanged', async (change) => {
    const source = legacySession('session')
    runtime.listSessions.mockResolvedValue({ ok: true, data: [source] })
    await exportLegacySessions(runtime.slug, runtime)
    runtime.listSessions.mockResolvedValue({ ok: true, data: [{ ...source, ...change }] })
    expect(await exportLegacySessions(runtime.slug, runtime)).toEqual({ ok: true, data: { archived: 1 } })
    expect(runtime.listMessages).toHaveBeenCalledTimes(2)
  })

  it('terminates on duplicate and cyclic child graphs without duplicating archives', async () => {
    const root = legacySession('root')
    const child = legacySession('child', 'root')
    runtime.listSessions.mockResolvedValue({ ok: true, data: [root, child, root] })
    runtime.listChildren.mockImplementation(async (id) => ({ ok: true, data: id === 'root' ? [child, child] : [root] }))
    expect(await exportLegacySessions(runtime.slug, runtime)).toEqual({ ok: true, data: { archived: 2 } })
    expect(runtime.listChildren).toHaveBeenCalledTimes(2)
    expect(runtime.listMessages).toHaveBeenCalledTimes(2)
  })

  it('succeeds for empty workspaces', async () => {
    expect(await exportLegacySessions(runtime.slug, runtime)).toEqual({ ok: true, data: { archived: 0 } })
    expect(mockStorage.upsertSession).not.toHaveBeenCalled()
  })

  it('keeps the same session id isolated by owner', async () => {
    runtime.listSessions.mockResolvedValue({ ok: true, data: [legacySession('same-id')] })
    await exportLegacySessions(runtime.slug, runtime)
    const otherRuntime = { ...runtime, slug: 'other-owner' }
    expect(await exportLegacySessions('other-owner', otherRuntime)).toEqual({ ok: true, data: { archived: 1 } })
    expect([...exported.keys()]).toEqual([`${runtime.slug}/same-id`, 'other-owner/same-id'])
  })

  it.each(['opencode-v2', 'unknown'])('rejects runtime kind %s without contacting it', async (kind) => {
    const result = await exportLegacySessions(runtime.slug, { ...runtime, kind })
    expect(result).toMatchObject({ ok: false, error: { code: 'runtime_unsupported' } })
    expect(runtime.listSessions).not.toHaveBeenCalled()
  })

  it('rejects workspace and message identity mismatches', async () => {
    expect(await exportLegacySessions('someone-else', runtime)).toMatchObject({ ok: false, error: { code: 'runtime_error' } })
    expect(runtime.listSessions).not.toHaveBeenCalled()
    runtime.listSessions.mockResolvedValue({ ok: true, data: [legacySession('root')] })
    runtime.listMessages.mockResolvedValue({ ok: true, data: [message({ sessionId: 'other-session' })] })
    expect(await exportLegacySessions(runtime.slug, runtime)).toMatchObject({ ok: false, error: { code: 'runtime_error' } })
    expect(mockStorage.upsertSession).not.toHaveBeenCalled()
  })

  it.each(['listSessions', 'listChildren', 'listMessages'] as const)('propagates %s failures', async (operation) => {
    runtime.listSessions.mockResolvedValue({ ok: true, data: [legacySession('root')] })
    runtime[operation].mockResolvedValue(harnessFailure('instance_unavailable'))
    expect(await exportLegacySessions(runtime.slug, runtime)).toEqual(harnessFailure('instance_unavailable'))
    expect(mockStorage.upsertSession).not.toHaveBeenCalled()
  })

  it('returns a typed failure on storage errors', async () => {
    runtime.listSessions.mockResolvedValue({ ok: true, data: [legacySession('root')] })
    mockStorage.upsertSession.mockRejectedValue(new Error('database unavailable'))
    expect(await exportLegacySessions(runtime.slug, runtime)).toMatchObject({ ok: false, error: { code: 'runtime_error', detail: expect.stringContaining('database unavailable') } })
  })

  it('never parses human-formatted timestamp labels as source dates', async () => {
    runtime.listSessions.mockResolvedValue({ ok: true, data: [{ ...legacySession('root'), createdAtRaw: undefined, updatedAt: 'Yesterday' }] })
    expect(await exportLegacySessions(runtime.slug, runtime)).toMatchObject({ ok: false, error: { code: 'runtime_error' } })
    expect(mockStorage.upsertSession).not.toHaveBeenCalled()
  })
})

describe('preArchiveRunningV1Instances', () => {
  async function loadJob() {
    vi.resetModules()
    return import('@/lib/harness/legacy-session-archive')
  }

  beforeEach(() => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-10-20T12:00:00Z'))
    vi.spyOn(console, 'info').mockImplementation(() => {})
    vi.spyOn(console, 'warn').mockImplementation(() => {})
    mockStorage.findNextRunningV1Instance.mockResolvedValue({ slug: runtime.slug })
  })

  it('handles one workspace per interval and logs each successful workspace', async () => {
    const { preArchiveRunningV1Instances, PRE_ARCHIVE_INTERVAL_MS } = await loadJob()
    runtime.listSessions.mockResolvedValue({ ok: true, data: [legacySession('root')] })
    expect(await preArchiveRunningV1Instances()).toBe(1)
    expect(console.info).toHaveBeenCalledWith('[legacy-session-archive] Pre-archived workspace:', { slug: runtime.slug, archived: 1 })
    expect(await preArchiveRunningV1Instances()).toBe(0)
    expect(mockStorage.findNextRunningV1Instance).toHaveBeenCalledTimes(1)

    vi.advanceTimersByTime(PRE_ARCHIVE_INTERVAL_MS)
    mockStorage.findNextRunningV1Instance.mockResolvedValue({ slug: 'next-workspace' })
    mockGetRuntime.mockResolvedValue({ ok: true, data: { ...runtime, slug: 'next-workspace' } })
    expect(await preArchiveRunningV1Instances()).toBe(1)
    expect(mockStorage.findNextRunningV1Instance).toHaveBeenLastCalledWith(runtime.slug)
    expect(console.info).toHaveBeenLastCalledWith('[legacy-session-archive] Pre-archived workspace:', { slug: 'next-workspace', archived: 1 })
  })

  it('does not count or retain a background snapshot fenced out by migration after the read', async () => {
    const { preArchiveRunningV1Instances } = await loadJob()
    runtime.listSessions.mockResolvedValue({ ok: true, data: [legacySession('root')] })
    mockStorage.upsertSession.mockResolvedValueOnce(false)

    expect(await preArchiveRunningV1Instances()).toBe(0)
    expect(mockStorage.upsertSession).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({ sessionId: 'root' }), { onlyWhileRunning: true })
    expect(exported.size).toBe(0)
    expect(console.info).toHaveBeenCalledWith('[legacy-session-archive] Pre-archived workspace:', { slug: runtime.slug, archived: 0 })

    expect(await exportLegacySessions(runtime.slug, runtime)).toEqual({ ok: true, data: { archived: 1 } })
    expect(mockStorage.upsertSession).toHaveBeenLastCalledWith(expect.objectContaining({ sessionId: 'root' }))
  })

  it('skips busy sessions but archives their idle descendants without persisting partial history', async () => {
    const { preArchiveRunningV1Instances } = await loadJob()
    const root = legacySession('root')
    runtime.listSessions.mockResolvedValue({ ok: true, data: [root] })
    runtime.listChildren.mockImplementation(async (id) => ({ ok: true, data: id === 'root' ? [legacySession('child', 'root')] : [] }))
    runtime.sessionStatus.mockResolvedValue({ ok: true, data: { root: { type: 'busy' } } })

    expect(await preArchiveRunningV1Instances()).toBe(1)
    expect(runtime.listMessages).toHaveBeenCalledExactlyOnceWith('child')
    expect(mockStorage.upsertSession).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({ sessionId: 'child' }), { onlyWhileRunning: true })
    expect(exported.has(`${runtime.slug}/root`)).toBe(false)

    runtime.sessionStatus.mockResolvedValue({ ok: true, data: {} })
    expect(await exportLegacySessions(runtime.slug, runtime)).toEqual({ ok: true, data: { archived: 1 } })
    expect(exported.has(`${runtime.slug}/root`)).toBe(true)
  })

  it.each(['busy', 'metadata'] as const)('discards a background snapshot with a %s race and retries it during final export', async (race) => {
    const { preArchiveRunningV1Instances } = await loadJob()
    const source = legacySession('root')
    runtime.listSessions.mockResolvedValue({ ok: true, data: [source] })
    if (race === 'busy') {
      runtime.sessionStatus.mockResolvedValueOnce({ ok: true, data: {} }).mockResolvedValueOnce({ ok: true, data: { root: { type: 'busy' } } })
    } else {
      runtime.getSession.mockResolvedValueOnce({ ok: true, data: { ...source, updatedAtRaw: source.updatedAtRaw! + 1 } })
    }

    expect(await preArchiveRunningV1Instances()).toBe(0)
    expect(mockStorage.upsertSession).not.toHaveBeenCalled()

    runtime.sessionStatus.mockResolvedValue({ ok: true, data: {} })
    runtime.listMessages.mockResolvedValue({ ok: true, data: [message({ sessionId: 'root', content: 'Finished reply' })] })
    expect(await exportLegacySessions(runtime.slug, runtime)).toEqual({ ok: true, data: { archived: 1 } })
    expect(exported.get(`${runtime.slug}/root`)?.messages).toEqual([expect.objectContaining({ content: 'Finished reply' })])
  })

  it('does not overlap workspaces even when a prior export exceeds the interval', async () => {
    const { preArchiveRunningV1Instances, PRE_ARCHIVE_INTERVAL_MS } = await loadJob()
    let finish: ((value: { ok: true; data: HarnessSession[] }) => void) | undefined
    runtime.listSessions.mockImplementation(() => new Promise((resolve) => { finish = resolve }))
    const first = preArchiveRunningV1Instances()
    await vi.waitFor(() => expect(runtime.listSessions).toHaveBeenCalled())
    vi.advanceTimersByTime(PRE_ARCHIVE_INTERVAL_MS)
    expect(await preArchiveRunningV1Instances()).toBe(0)
    expect(mockStorage.findNextRunningV1Instance).toHaveBeenCalledTimes(1)
    finish!({ ok: true, data: [] })
    await first
  })

  it('does nothing when no running v1 workspace remains', async () => {
    const { preArchiveRunningV1Instances } = await loadJob()
    mockStorage.findNextRunningV1Instance.mockResolvedValue(null)
    expect(await preArchiveRunningV1Instances()).toBe(0)
    expect(mockGetRuntime).not.toHaveBeenCalled()
  })

  it('handles a workspace that switched to v2 after candidate selection without exporting it', async () => {
    const { preArchiveRunningV1Instances } = await loadJob()
    mockGetRuntime.mockResolvedValue({ ok: true, data: { ...runtime, kind: 'opencode-v2' } })
    expect(await preArchiveRunningV1Instances()).toBe(0)
    expect(runtime.listSessions).not.toHaveBeenCalled()
    expect(console.warn).toHaveBeenCalledWith('[legacy-session-archive] Pre-archive failed:', expect.objectContaining({ slug: runtime.slug }))
  })

  it('logs errors, remains rate-limited, and releases its lock for a later retry', async () => {
    const { preArchiveRunningV1Instances, PRE_ARCHIVE_INTERVAL_MS } = await loadJob()
    mockStorage.findNextRunningV1Instance.mockRejectedValueOnce(new Error('db unavailable'))
    expect(await preArchiveRunningV1Instances()).toBe(0)
    expect(await preArchiveRunningV1Instances()).toBe(0)
    expect(console.warn).toHaveBeenCalledWith('[legacy-session-archive] Pre-archive failed:', expect.objectContaining({ error: expect.any(Error) }))
    vi.advanceTimersByTime(PRE_ARCHIVE_INTERVAL_MS)
    await preArchiveRunningV1Instances()
    expect(mockGetRuntime).toHaveBeenCalledTimes(1)
  })
})

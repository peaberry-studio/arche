import { beforeEach, describe, expect, it, vi } from 'vitest'

import { createMockHarnessRuntime } from '@/actions/__tests__/helpers/harness-runtime'
import { listSessionFamilyAction, listSessionsAction } from '@/actions/workspace-sessions'
import type { HarnessSession } from '@/lib/harness/contract'
import { getRuntimeForSlug } from '@/lib/harness/registry'
import { getSession } from '@/lib/runtime/session'
import { flowService } from '@/lib/services'
import * as legacySessionArchive from '@/lib/services/legacy-session-archive'

vi.mock('@/lib/runtime/session', () => ({ getSession: vi.fn() }))
vi.mock('@/lib/services/legacy-session-archive', () => ({ findSession: vi.fn(), listSessions: vi.fn(), isArchivedSession: vi.fn() }))
vi.mock('@/lib/harness/registry', () => ({ getRuntimeForSlug: vi.fn() }))
vi.mock('@/lib/services', () => ({
  flowService: { findSessionMetadataForWorkspace: vi.fn() },
  userService: { findIdBySlug: vi.fn() },
}))

const runtime = createMockHarnessRuntime()
const success = <T,>(data: T) => ({ ok: true as const, data })
const record = (id: string, title = id, updatedAtRaw = 100, parentId?: string): HarnessSession => ({
  id, title, updatedAtRaw, parentId, updatedAt: 'Today', status: 'idle',
})

beforeEach(() => {
  vi.resetAllMocks()
  vi.mocked(legacySessionArchive.listSessions).mockResolvedValue([])
  vi.mocked(legacySessionArchive.findSession).mockResolvedValue(null)
  vi.mocked(getSession).mockResolvedValue({
    user: { id: 'user-1', email: 'alice@test.com', slug: 'alice', role: 'USER' }, sessionId: 'auth-1',
  })
  vi.mocked(getRuntimeForSlug).mockResolvedValue(success(runtime))
  runtime.listSessions.mockResolvedValue(success([]))
  runtime.getSession.mockResolvedValue({ ok: false, error: { code: 'session_not_found' } })
  runtime.listChildren.mockResolvedValue(success([]))
  runtime.sessionStatus.mockResolvedValue(success({ root: { type: 'busy' } }))
  vi.mocked(flowService.findSessionMetadataForWorkspace).mockResolvedValue([{
    openCodeSessionId: 'root', trigger: 'schedule', flowId: 'flow-1', flowName: 'Daily brief',
    runId: 'run-1', status: 'succeeded', hasUnseenResult: true,
  }])
})

describe('session listing actions', () => {
  it('merges archives without duplicate live IDs and keeps live pagination', async () => {
    const archive = { ...record('old', 'Old chat'), archived: true as const }
    vi.mocked(legacySessionArchive.listSessions).mockResolvedValue([archive, { ...record('child', 'Child', 90, 'old'), archived: true }])
    runtime.listSessions.mockResolvedValue(success([record('live'), record('old', 'Colliding live ID')]))
    expect(await listSessionsAction('alice', { rootsOnly: true, limit: 2 })).toMatchObject({
      ok: true, hasMore: true, sessions: [{ id: 'live' }, archive],
    })
  })
  it('serves archive-only lists and full families while the runtime is offline', async () => {
    const root = { ...record('old'), archived: true as const }
    const child = { ...record('child', 'Child', 90, 'old'), archived: true as const }
    vi.mocked(legacySessionArchive.listSessions).mockResolvedValue([root, child])
    vi.mocked(legacySessionArchive.findSession).mockResolvedValue({ session: child, messages: [] })
    vi.mocked(getRuntimeForSlug).mockResolvedValue({ ok: false, error: { code: 'instance_unavailable' } })
    expect(await listSessionsAction('alice', { rootsOnly: true })).toEqual({ ok: true, hasMore: false, sessions: [root] })
    vi.mocked(getRuntimeForSlug).mockClear()
    expect(await listSessionFamilyAction('alice', 'child')).toEqual({ ok: true, rootSessionId: 'old', sessions: [root, child] })
    expect(getRuntimeForSlug).not.toHaveBeenCalled()
  })
  it('searches archive titles and excludes hidden learning archives', async () => {
    vi.mocked(legacySessionArchive.listSessions).mockResolvedValue([
      { ...record('old', 'Daily archive'), archived: true },
      { ...record('learning', 'Learning | Daily archive'), archived: true },
    ])
    expect((await listSessionsAction('alice', { query: 'daily' })).sessions?.map((session) => session.id)).toEqual(['old'])
  })
  it('keeps archives readable when runtime listing throws a connection error', async () => {
    const archive = { ...record('old'), archived: true as const }
    vi.mocked(legacySessionArchive.listSessions).mockResolvedValue([archive])
    runtime.listSessions.mockRejectedValue(new Error('connection refused'))
    expect(await listSessionsAction('alice')).toEqual({ ok: true, hasMore: false, sessions: [archive] })
  })
  it.each([listSessionsAction, (slug: string) => listSessionFamilyAction(slug, 's1')])('rejects another user before archive reads', async (action) => {
    expect(await action('bob')).toEqual({ ok: false, error: 'forbidden' })
    expect(legacySessionArchive.listSessions).not.toHaveBeenCalled()
    expect(legacySessionArchive.findSession).not.toHaveBeenCalled()
  })
  it('lists normalized root sessions with optimistic pagination and flow metadata', async () => {
    runtime.listSessions.mockResolvedValue(success([{ ...record('root', 'Daily brief', 200), share: { url: 'https://share.test/root', version: 1 } }]))
    const result = await listSessionsAction('alice', { limit: 1, rootsOnly: true })
    expect(runtime.listSessions).toHaveBeenCalledWith({ limit: 1, rootsOnly: true, start: undefined })
    expect(result).toMatchObject({ ok: true, hasMore: true, sessions: [{
      id: 'root', title: 'Daily brief', status: 'idle', updatedAtRaw: 200,
      share: { url: 'https://share.test/root', version: 1 },
      flow: { runId: 'run-1', flowName: 'Daily brief', hasUnseenResult: true },
    }] })
    expect(flowService.findSessionMetadataForWorkspace).toHaveBeenCalledWith('user-1', ['root'])
  })
  it.each([
    ['session list', () => listSessionsAction('alice', { limit: 1, rootsOnly: true })],
    ['session family', () => listSessionFamilyAction('alice', 'root')],
  ] as const)('keeps the successful %s and flow metadata when optional status fails', async (_name, action) => {
    runtime.listSessions.mockResolvedValue(success([record('root', 'Daily brief', 200)]))
    runtime.getSession.mockResolvedValue(success(record('root', 'Daily brief', 200)))
    runtime.sessionStatus.mockResolvedValue({ ok: false, error: { code: 'runtime_error' } })

    expect(await action()).toMatchObject({ ok: true, sessions: [{
      id: 'root', title: 'Daily brief', status: 'idle', updatedAtRaw: 200,
      flow: { runId: 'run-1', flowName: 'Daily brief', hasUnseenResult: true },
    }] })
    expect(flowService.findSessionMetadataForWorkspace).toHaveBeenCalledWith('user-1', ['root'])
  })
  it('normalizes finite limit/start values and forwards the start timestamp', async () => {
    await listSessionsAction('alice', { limit: 2.8, rootsOnly: true, start: 25.9 })
    expect(runtime.listSessions).toHaveBeenCalledWith({ limit: 2, rootsOnly: true, start: 25 })
    await listSessionsAction('alice', { limit: Number.NaN, start: Number.POSITIVE_INFINITY })
    expect(runtime.listSessions).toHaveBeenLastCalledWith({ limit: undefined, rootsOnly: undefined, start: undefined })
  })
  it('hides learning sessions without losing full-page pagination', async () => {
    runtime.listSessions.mockResolvedValue(success([
      record('chat', 'Regular chat'), record('learning', 'Learning | Regular chat'),
      record('flow-learning', 'Flow | Learning | Weekly review'),
    ]))
    expect(await listSessionsAction('alice', { limit: 3, rootsOnly: true })).toMatchObject({
      ok: true, hasMore: true, sessions: [{ id: 'chat', title: 'Regular chat' }],
    })
  })
  it('searches up to 100 recent sessions by title and flow name', async () => {
    runtime.listSessions.mockResolvedValue(success([record('root', 'Unrelated'), record('manual', 'Daily chat')]))
    const result = await listSessionsAction('alice', { limit: 500, query: ' DAILY ', rootsOnly: true })
    expect(runtime.listSessions).toHaveBeenCalledWith({ limit: 100, rootsOnly: true, start: undefined })
    expect(result).toMatchObject({ ok: true, hasMore: false, sessions: [{ id: 'root' }, { id: 'manual' }] })
  })
  it('caps search results at 20', async () => {
    runtime.listSessions.mockResolvedValue(success(Array.from({ length: 30 }, (_, i) => record(`${i}`, 'Daily'))))
    expect((await listSessionsAction('alice', { query: 'daily' })).sessions).toHaveLength(20)
  })
  it('shows terminal retry failures without treating active sessions as list activity', async () => {
    runtime.listSessions.mockResolvedValue(success([record('root')]))
    runtime.sessionStatus.mockResolvedValue(success({ root: { type: 'retry', terminalError: 'free_tier_limit' } }))
    expect((await listSessionsAction('alice')).sessions?.[0].status).toBe('error')
  })
  it('loads the full active family through normalized parent ids', async () => {
    runtime.getSession.mockResolvedValueOnce(success(record('child', 'Child', 150, 'root')))
      .mockResolvedValueOnce(success(record('root', 'Root', 200)))
    runtime.listChildren.mockResolvedValueOnce(success([record('child', 'Child', 150, 'root')]))
      .mockResolvedValueOnce(success([record('grandchild', 'Grandchild', 175, 'child')]))
    const result = await listSessionFamilyAction('alice', 'child')
    expect(runtime.getSession).toHaveBeenNthCalledWith(1, 'child')
    expect(runtime.getSession).toHaveBeenNthCalledWith(2, 'root')
    expect(runtime.listChildren).toHaveBeenCalledWith('grandchild')
    expect(result).toMatchObject({ ok: true, rootSessionId: 'root', sessions: [
      { id: 'root' }, { id: 'grandchild', parentId: 'child' }, { id: 'child', parentId: 'root' },
    ] })
  })
  it('bounds traversal when the harness reports cycles and repeated children', async () => {
    runtime.getSession.mockResolvedValueOnce(success(record('a', 'A', 100, 'b')))
      .mockResolvedValueOnce(success(record('b', 'B', 100, 'a')))
      .mockResolvedValueOnce(success(record('a', 'A', 100, 'b')))
    runtime.listChildren.mockResolvedValue(success([record('a', 'A', 100, 'b'), record('b', 'B', 100, 'a')]))
    expect((await listSessionFamilyAction('alice', 'a')).sessions?.map((item) => item.id)).toEqual(['b', 'a'])
    expect(runtime.listChildren).toHaveBeenCalledTimes(2)
  })
  it('returns not_found for missing families and typed errors for other failures', async () => {
    expect(await listSessionFamilyAction('alice', 'missing')).toEqual({ ok: false, error: 'not_found' })
    runtime.listSessions.mockResolvedValue({ ok: false, error: { code: 'runtime_error', detail: 'wire' } })
    expect(await listSessionsAction('alice')).toEqual({ ok: false, error: 'runtime_error' })
  })
  it.each([listSessionsAction, (slug: string) => listSessionFamilyAction(slug, 's1')])('authorizes before resolving a runtime', async (action) => {
    vi.mocked(getSession).mockResolvedValue(null)
    expect(await action('alice')).toEqual({ ok: false, error: 'unauthorized' })
    expect(getRuntimeForSlug).not.toHaveBeenCalled()
  })
})

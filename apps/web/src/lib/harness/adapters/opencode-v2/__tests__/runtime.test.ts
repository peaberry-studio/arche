import { beforeEach, describe, expect, it, vi } from 'vitest'

import { createOpenCodeV2Runtime } from '@/lib/harness/adapters/opencode-v2/runtime'

const mocks = vi.hoisted(() => ({ client: vi.fn(), health: vi.fn(), sync: vi.fn(), events: vi.fn() }))
vi.mock('@/lib/harness/adapters/opencode-v2/client', async (importOriginal) => ({
  ...await importOriginal<typeof import('@/lib/harness/adapters/opencode-v2/client')>(),
  createInstanceClient: mocks.client,
  checkHealth: mocks.health,
}))
vi.mock('@/lib/harness/adapters/opencode-v1/connection-resolver', () => ({ getInstanceBasicAuth: vi.fn(), getInstanceUrl: vi.fn() }))
vi.mock('@/lib/harness/adapters/opencode-v2/providers', () => ({ syncProviderAccess: mocks.sync }))
vi.mock('@/lib/harness/adapters/opencode-v2/events', () => ({ subscribeOpenCodeEvents: mocks.events }))

function session(id: string, parentID?: string) {
  return { id, parentID, title: id, time: { created: 10, updated: 20 }, location: { directory: '/workspace' } }
}

describe('V2 runtime', () => {
  beforeEach(() => { vi.clearAllMocks() })

  it('normalizes complete, directory-scoped pagination including short pages with cursors', async () => {
    const list = vi.fn()
      .mockResolvedValueOnce({ data: [session('s1')], cursor: { next: 'one' } })
      .mockResolvedValueOnce({ data: [session('s2')], cursor: { next: 'two' } })
      .mockResolvedValueOnce({ data: [], cursor: { next: null } })
    mocks.client.mockResolvedValue({ location: { get: vi.fn().mockResolvedValue({ directory: '/workspace' }) }, session: { list } })
    const result = await createOpenCodeV2Runtime('alice').listSessions()
    expect(result.ok && result.data.map((s) => s.id)).toEqual(['s1', 's2'])
    expect(result.ok && result.data[0]).toMatchObject({ createdAtRaw: 10, updatedAtRaw: 20, status: 'idle' })
    expect(result.ok && result.data[0]).not.toHaveProperty('location')
    expect(list).toHaveBeenNthCalledWith(3, { directory: '/workspace', order: 'desc', limit: 100, cursor: 'two' })
  })

  it('fails an incomplete inventory instead of looping on a repeated cursor', async () => {
    mocks.client.mockResolvedValue({ location: { get: vi.fn().mockResolvedValue({ directory: '/workspace' }) }, session: {
      list: vi.fn().mockResolvedValue({ data: [session('s1')], cursor: { next: 'repeated' } }),
    } })
    expect(await createOpenCodeV2Runtime('alice').listSessions()).toMatchObject({ ok: false, error: { code: 'runtime_error', detail: 'V2 pagination cursor repeated' } })
  })

  it('verifies the root before listing immediate children', async () => {
    const list = vi.fn().mockResolvedValue({ data: [session('child', 'root')], cursor: { next: null } })
    const get = vi.fn().mockResolvedValue(session('root'))
    mocks.client.mockResolvedValue({ location: { get: vi.fn().mockResolvedValue({ directory: '/workspace' }) }, session: { get, list } })
    const result = await createOpenCodeV2Runtime('alice').listChildren('root')
    expect(result.ok && result.data[0].parentId).toBe('root')
    expect(list).toHaveBeenCalledWith(expect.objectContaining({ parentID: 'root' }))
    expect(get).toHaveBeenCalledWith({ sessionID: 'root' })
  })

  it('re-reads a renamed session after the native 204 response', async () => {
    const update = vi.fn().mockResolvedValue(undefined)
    mocks.client.mockResolvedValue({ session: { update, get: vi.fn().mockResolvedValue({ ...session('s1'), title: 'renamed' }) } })
    const result = await createOpenCodeV2Runtime('alice').updateSession('s1', 'renamed')
    expect(result.ok && result.data.title).toBe('renamed')
    expect(update).toHaveBeenCalledWith({ sessionID: 's1', title: 'renamed' })
  })

  it('does not turn interrupt acknowledgement into family-idle confirmation', async () => {
    const interrupt = vi.fn().mockResolvedValue({ interrupted: false })
    mocks.client.mockResolvedValue({ session: { get: vi.fn().mockResolvedValue(session('s1')), interrupt } })
    const runtime = createOpenCodeV2Runtime('alice')
    expect(await runtime.abortSession('s1')).toEqual({ ok: true, data: undefined })
    expect(interrupt).toHaveBeenCalledWith({ sessionID: 's1', resume: false })
    expect(await runtime.sessionStatus()).toEqual({ ok: false, error: { code: 'runtime_unsupported', detail: 'v2_family_idle_confirmation_unverified' } })
  })

  it('does not interrupt a nonexistent session even if native interrupt would acknowledge it', async () => {
    const interrupt = vi.fn()
    mocks.client.mockResolvedValue({ session: { get: vi.fn().mockRejectedValue({ _tag: 'SessionNotFoundError' }), interrupt } })
    expect(await createOpenCodeV2Runtime('alice').abortSession('missing')).toMatchObject({ ok: false, error: { code: 'session_not_found' } })
    expect(interrupt).not.toHaveBeenCalled()
  })

  it('fails unsupported prompt behavior explicitly without submitting a lossy prompt', async () => {
    const prompt = vi.fn()
    mocks.client.mockResolvedValue({ session: { get: vi.fn().mockResolvedValue(session('s1')), prompt } })
    expect(await createOpenCodeV2Runtime('alice').prompt({ sessionId: 's1', agent: 'reviewer', model: { providerId: 'openai', modelId: 'test' }, noReply: true, parts: [{ type: 'text', text: 'hello' }] })).toMatchObject({ ok: false, error: { code: 'runtime_unsupported' } })
    expect(prompt).not.toHaveBeenCalled()
  })

  it('preserves verified text prompt IDs, selection and cancellation at the native boundary', async () => {
    const prompt = vi.fn().mockResolvedValue({ id: 'msg_fixture_text' })
    const switchAgent = vi.fn().mockResolvedValue(undefined)
    const switchModel = vi.fn().mockResolvedValue(undefined)
    mocks.client.mockResolvedValue({ session: { get: vi.fn().mockResolvedValue(session('s1')), prompt, switchAgent, switchModel } })
    const signal = new AbortController().signal
    expect(await createOpenCodeV2Runtime('alice').prompt({ sessionId: 's1', messageId: 'msg_fixture_text', agent: 'reviewer', model: { providerId: 'fixture', modelId: 'alternate' }, parts: [{ type: 'text', text: 'hello' }] }, { signal })).toEqual({ ok: true, data: undefined })
    expect(switchAgent).toHaveBeenCalledWith({ sessionID: 's1', agent: 'reviewer' }, { signal })
    expect(switchModel).toHaveBeenCalledWith({ sessionID: 's1', model: { providerID: 'fixture', id: 'alternate' } }, { signal })
    expect(prompt).toHaveBeenCalledWith({ sessionID: 's1', id: 'msg_fixture_text', text: 'hello' }, { signal })
  })

  it('supplies the requested session ID missing from native message records', async () => {
    mocks.client.mockResolvedValue({ session: { get: vi.fn().mockResolvedValue(session('s1')) }, message: { list: vi.fn().mockResolvedValue({
      data: [{ id: 'msg1', type: 'user', text: 'hello', time: { created: 1 } }], cursor: { next: null },
    }) } })
    const result = await createOpenCodeV2Runtime('alice').listMessages('s1')
    expect(result.ok && result.data).toMatchObject([{ id: 'msg1', sessionId: 's1', role: 'user', content: 'hello' }])
  })

  it.each(['once', 'always', 'reject'] as const)('maps permission decision %s with its owning session', async (response) => {
    const reply = vi.fn().mockResolvedValue(undefined)
    mocks.client.mockResolvedValue({ permission: { reply } })
    const signal = new AbortController().signal
    expect(await createOpenCodeV2Runtime('alice').replyPermission({ sessionId: 's1', permissionId: 'p1', response }, { signal })).toEqual({ ok: true, data: undefined })
    expect(reply).toHaveBeenCalledWith({ sessionID: 's1', requestID: 'p1', decision: response }, { signal })
  })

  it('delegates provider synchronization and event subscription without v1 fallback', async () => {
    const input = { userId: 'u1', force: true, ignoreActiveRunId: 'r1' }
    const signal = new AbortController().signal
    const runtime = createOpenCodeV2Runtime('alice')
    await runtime.syncProviderAccess(input)
    await runtime.subscribeEvents(signal)
    expect(mocks.sync).toHaveBeenCalledWith('alice', input)
    expect(mocks.events).toHaveBeenCalledWith('alice', signal)
  })
})

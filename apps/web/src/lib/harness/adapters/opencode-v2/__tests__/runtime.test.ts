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

  it.each([undefined, 'parent'])('creates a directory-scoped session with parent %s', async (parentId) => {
    const create = vi.fn().mockResolvedValue(session('new', parentId))
    const get = vi.fn().mockResolvedValue(session('parent'))
    mocks.client.mockResolvedValue({ location: { get: vi.fn().mockResolvedValue({ directory: '/workspace' }) }, session: { create, get } })
    const result = await createOpenCodeV2Runtime('alice').createSession({ title: 'New session', parentId })
    expect(result).toMatchObject({ ok: true, data: { id: 'new', createdAtRaw: 10, updatedAtRaw: 20 } })
    expect(result.ok && result.data.parentId).toBe(parentId)
    expect(create).toHaveBeenCalledWith({ title: 'New session', parentID: parentId, location: { directory: '/workspace' } })
    expect(mocks.client).toHaveBeenCalledWith('alice')
    if (parentId) expect(get).toHaveBeenCalledWith({ sessionID: parentId })
    else expect(get).not.toHaveBeenCalled()
  })

  it('does not create a child of a missing parent', async () => {
    const create = vi.fn()
    mocks.client.mockResolvedValue({ location: { get: vi.fn().mockResolvedValue({ directory: '/workspace' }) }, session: {
      create, get: vi.fn().mockRejectedValue({ _tag: 'SessionNotFoundError', message: 'Parent missing' }),
    } })
    expect(await createOpenCodeV2Runtime('alice').createSession({ parentId: 'missing' })).toEqual({ ok: false, error: { code: 'session_not_found', detail: 'Parent missing', status: 404 } })
    expect(create).not.toHaveBeenCalled()
  })

  it('deletes through the native remove operation and accepts its 204 response', async () => {
    const remove = vi.fn().mockResolvedValue(undefined)
    mocks.client.mockResolvedValue({ session: { remove } })
    expect(await createOpenCodeV2Runtime('alice').deleteSession('s1')).toEqual({ ok: true, data: undefined })
    expect(remove).toHaveBeenCalledWith({ sessionID: 's1' })
  })

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

  it('deduplicates pages before applying a root-only inventory limit', async () => {
    const list = vi.fn()
      .mockResolvedValueOnce({ data: [session('s1')], cursor: { next: 'one' } })
      .mockResolvedValueOnce({ data: [{ ...session('s1'), title: 'updated' }, session('s2'), session('s3')], cursor: { next: 'two' } })
    mocks.client.mockResolvedValue({ location: { get: vi.fn().mockResolvedValue({ directory: '/workspace' }) }, session: { list } })
    const result = await createOpenCodeV2Runtime('alice').listSessions({ rootsOnly: true, limit: 2 })
    expect(result.ok && result.data.map(({ id, title }) => ({ id, title }))).toEqual([{ id: 's1', title: 'updated' }, { id: 's2', title: 's2' }])
    expect(list).toHaveBeenCalledTimes(2)
    expect(list).toHaveBeenNthCalledWith(2, { directory: '/workspace', parentID: null, order: 'desc', limit: 100, cursor: 'one' })
  })

  it('returns a typed failure rather than a partial session inventory when a later page fails', async () => {
    const list = vi.fn()
      .mockResolvedValueOnce({ data: [session('s1')], cursor: { next: 'one' } })
      .mockRejectedValueOnce({ reason: 'Transport', message: 'Connection lost' })
    mocks.client.mockResolvedValue({ location: { get: vi.fn().mockResolvedValue({ directory: '/workspace' }) }, session: { list } })
    expect(await createOpenCodeV2Runtime('alice').listSessions()).toEqual({ ok: false, error: { code: 'fetch_failed', detail: 'Connection lost' } })
  })

  it('rejects an unverified start filter without contacting the runtime', async () => {
    expect(await createOpenCodeV2Runtime('alice').listSessions({ start: 10 })).toEqual({ ok: false, error: { code: 'runtime_unsupported', detail: 'v2_session_start_filter_unverified' } })
    expect(mocks.client).not.toHaveBeenCalled()
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

  it('reports status from active drains only, independent of the interrupt acknowledgement', async () => {
    const interrupt = vi.fn().mockResolvedValue({ interrupted: false })
    const active = vi.fn().mockResolvedValue({ s1: { type: 'running' } })
    mocks.client.mockResolvedValue({ session: { get: vi.fn().mockResolvedValue(session('s1')), interrupt, active, inbox: { list: vi.fn().mockResolvedValue([]) } } })
    const runtime = createOpenCodeV2Runtime('alice')
    const signal = new AbortController().signal
    expect(await runtime.abortSession('s1')).toEqual({ ok: true, data: undefined })
    expect(interrupt).toHaveBeenCalledWith({ sessionID: 's1', resume: false })
    expect(await runtime.sessionStatus({ signal })).toEqual({ ok: true, data: { s1: { type: 'busy' } } })
    expect(active).toHaveBeenCalledWith({ signal })
  })

  it('does not interrupt a nonexistent session even if native interrupt would acknowledge it', async () => {
    const interrupt = vi.fn()
    mocks.client.mockResolvedValue({ session: { get: vi.fn().mockRejectedValue({ _tag: 'SessionNotFoundError' }), interrupt } })
    expect(await createOpenCodeV2Runtime('alice').abortSession('missing')).toMatchObject({ ok: false, error: { code: 'session_not_found' } })
    expect(interrupt).not.toHaveBeenCalled()
  })

  it('cancels retained inbox items after interrupt before acknowledging the abort primitive', async () => {
    const list = vi.fn().mockResolvedValueOnce([{ id: 'queued' }]).mockResolvedValueOnce([])
    const cancel = vi.fn().mockResolvedValue(undefined)
    const interrupt = vi.fn().mockResolvedValue({ interrupted: true })
    mocks.client.mockResolvedValue({ session: { get: vi.fn().mockResolvedValue(session('s1')), interrupt, inbox: { list, cancel } } })
    expect(await createOpenCodeV2Runtime('alice').abortSession('s1')).toEqual({ ok: true, data: undefined })
    expect(cancel).toHaveBeenCalledWith({ sessionID: 's1', inboxID: 'queued' })
    expect(interrupt.mock.invocationCallOrder[0]).toBeLessThan(list.mock.invocationCallOrder[0])
    expect(list).toHaveBeenCalledTimes(2)
  })

  it('does not acknowledge abort when a late inbox item remains', async () => {
    mocks.client.mockResolvedValue({ session: { get: vi.fn().mockResolvedValue(session('s1')), interrupt: vi.fn().mockResolvedValue({ interrupted: true }), inbox: {
      list: vi.fn().mockResolvedValueOnce([]).mockResolvedValueOnce([{ id: 'late' }]),
    } } })
    expect(await createOpenCodeV2Runtime('alice').abortSession('s1')).toEqual({ ok: false, error: { code: 'execution_termination_unconfirmed', detail: 'v2_inbox_not_empty_after_interrupt' } })
  })

  it('preserves inbox cancellation failure rather than claiming the queue was drained', async () => {
    mocks.client.mockResolvedValue({ session: { get: vi.fn().mockResolvedValue(session('s1')), interrupt: vi.fn().mockResolvedValue({ interrupted: true }), inbox: {
      list: vi.fn().mockResolvedValue([{ id: 'queued' }]), cancel: vi.fn().mockRejectedValue({ reason: 'Transport', message: 'Disconnected' }),
    } } })
    expect(await createOpenCodeV2Runtime('alice').abortSession('s1')).toMatchObject({ ok: false, error: { code: 'fetch_failed' } })
  })

  it('keeps no-reply input queued without resuming the session', async () => {
    const prompt = vi.fn().mockResolvedValue({ id: 'msg_note', type: 'user' })
    mocks.client.mockResolvedValue({ session: { get: vi.fn().mockResolvedValue({ ...session('s1'), agent: 'reviewer' }), prompt } })
    expect(await createOpenCodeV2Runtime('alice').prompt({ sessionId: 's1', messageId: 'msg_note', agent: 'reviewer', noReply: true, parts: [{ type: 'text', text: 'hello' }] })).toEqual({ ok: true, data: undefined })
    expect(prompt).toHaveBeenCalledWith({ sessionID: 's1', id: 'msg_note', text: 'hello', resume: false }, undefined)
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
    mocks.client.mockResolvedValue({ session: { get: vi.fn().mockResolvedValue(session('s1')), inbox: { list: vi.fn().mockResolvedValue([]) } }, message: { list: vi.fn().mockResolvedValue({
      data: [{ id: 'msg1', type: 'user', text: 'hello', time: { created: 1 } }], cursor: { next: null },
    }) } })
    const result = await createOpenCodeV2Runtime('alice').listMessages('s1')
    expect(result.ok && result.data).toMatchObject([{ id: 'msg1', sessionId: 's1', role: 'user', content: 'hello' }])
  })

  it('exhausts chronological message pages and deduplicates overlapping records', async () => {
    const message = (id: string, text: string) => ({ id, type: 'user', text, time: { created: 1 } })
    const list = vi.fn()
      .mockResolvedValueOnce({ data: [message('msg1', 'old')], cursor: { next: 'one' } })
      .mockResolvedValueOnce({ data: [message('msg1', 'updated'), message('msg2', 'next')], cursor: { next: 'two' } })
      .mockResolvedValueOnce({ data: [], cursor: { next: null } })
    mocks.client.mockResolvedValue({ session: { get: vi.fn().mockResolvedValue(session('s1')), inbox: { list: vi.fn().mockResolvedValue([]) } }, message: { list } })
    const result = await createOpenCodeV2Runtime('alice').listMessages('s1')
    expect(result.ok && result.data.map(({ id, content }) => ({ id, content }))).toEqual([{ id: 'msg1', content: 'updated' }, { id: 'msg2', content: 'next' }])
    expect(list).toHaveBeenNthCalledWith(1, { sessionID: 's1', order: 'asc', limit: 100 })
    expect(list).toHaveBeenNthCalledWith(3, { sessionID: 's1', limit: 100, cursor: 'two' })
  })

  it('appends undelivered user/synthetic inbox input read before the history, without duplicating delivered input', async () => {
    const order: string[] = []
    const inbox = vi.fn(async () => {
      order.push('inbox')
      return [
        { id: 'msg1', sessionID: 's1', type: 'user', delivery: 'steer', payload: { text: 'delivered meanwhile' }, time: { created: 1 } },
        { id: 'queued', sessionID: 's1', type: 'user', delivery: 'queue', payload: { text: 'pending' }, time: { created: 3 } },
        { id: 'compact', sessionID: 's1', type: 'compaction', delivery: 'queue', payload: {}, time: { created: 4 } },
      ]
    })
    const list = vi.fn(async () => {
      order.push('messages')
      return { data: [{ id: 'msg1', type: 'user', text: 'delivered meanwhile', time: { created: 2 } }], cursor: { next: null } }
    })
    mocks.client.mockResolvedValue({ session: { get: vi.fn().mockResolvedValue(session('s1')), inbox: { list: inbox } }, message: { list } })
    const result = await createOpenCodeV2Runtime('alice').listMessages('s1')
    expect(result.ok && result.data.map(({ id, role, content, timestampRaw }) => ({ id, role, content, timestampRaw }))).toEqual([
      { id: 'msg1', role: 'user', content: 'delivered meanwhile', timestampRaw: 2 },
      { id: 'queued', role: 'user', content: 'pending', timestampRaw: 3 },
    ])
    expect(order).toEqual(['inbox', 'messages'])
  })

  it('lists only enabled models with canonical provider IDs, native defaults and untiered prices', async () => {
    mocks.client.mockResolvedValue({ model: {
      list: vi.fn().mockResolvedValue({ data: [
        { id: 'priced', name: 'Priced', providerID: 'fireworks-ai', enabled: true, cost: [{ tier: 'large', input: 99, output: 99 }, { input: 1, output: 2 }] },
        { id: 'custom', name: 'Custom', providerID: 'fixture', enabled: true, cost: [{ tier: 'large', input: 99, output: 99 }] },
        { id: 'disabled', name: 'Disabled', providerID: 'openai', enabled: false, cost: [] },
      ] }),
      default: vi.fn().mockResolvedValue({ data: { providerID: 'fireworks-ai', id: 'priced' } }),
    } })
    expect(await createOpenCodeV2Runtime('alice').listModels()).toEqual({ ok: true, data: [
      { providerId: 'fireworks', providerName: 'Fireworks AI', modelId: 'priced', modelName: 'Priced', isDefault: true, cost: { input: 1, output: 2 } },
      { providerId: 'fixture', providerName: 'fixture', modelId: 'custom', modelName: 'Custom', isDefault: false },
    ] })
  })

  it('does not invent a default model or price when the catalog provides neither', async () => {
    mocks.client.mockResolvedValue({ model: {
      list: vi.fn().mockResolvedValue({ data: [{ id: 'free', name: 'Free', providerID: 'openai', enabled: true, cost: [] }] }),
      default: vi.fn().mockResolvedValue({ data: null }),
    } })
    expect(await createOpenCodeV2Runtime('alice').listModels()).toEqual({ ok: true, data: [
      { providerId: 'openai', providerName: 'OpenAI', modelId: 'free', modelName: 'Free', isDefault: false },
    ] })
  })

  it('normalizes agent model references without inventing missing selections', async () => {
    mocks.client.mockResolvedValue({ agent: { list: vi.fn().mockResolvedValue({ data: [
      { id: 'reviewer', name: 'Reviewer', description: 'Reviews', model: { providerID: 'fireworks-ai', id: 'coding' } },
      { id: 'custom', name: 'Custom', model: { providerID: 'fixture', id: 'test' } },
      { id: 'unselected', name: 'Unselected' },
    ] }) } })
    expect(await createOpenCodeV2Runtime('alice').listAgents()).toEqual({ ok: true, data: [
      { id: 'reviewer', name: 'Reviewer', description: 'Reviews', model: { providerId: 'fireworks', modelId: 'coding' } },
      { id: 'custom', name: 'Custom', model: { providerId: 'fixture', modelId: 'test' } },
      { id: 'unselected', name: 'Unselected' },
    ] })
  })

  it('lists native connector keys and treats only connected servers as available', async () => {
    const list = vi.fn().mockResolvedValue({ data: [
      { name: 'ready', status: { status: 'connected' } },
      { name: 'waiting', status: { status: 'pending' } },
      { name: 'off', status: { status: 'disabled' } },
      { name: 'broken', status: { status: 'failed', error: 'Unavailable' } },
      { name: 'auth', status: { status: 'needs_auth', error: 'Sign in' } },
    ] })
    mocks.client.mockResolvedValue({ mcp: { list } })
    const runtime = createOpenCodeV2Runtime('alice')
    expect(await runtime.listConnectorKeys()).toEqual({ ok: true, data: ['ready', 'waiting', 'off', 'broken', 'auth'] })
    expect(await runtime.listConnectorStatus()).toEqual({ ok: true, data: { ready: true, waiting: false, off: false, broken: false, auth: false } })
    expect(list).toHaveBeenCalledTimes(2)
  })

  it('normalizes added, modified and deleted session diffs without native field leakage', async () => {
    const diff = vi.fn().mockResolvedValue(['added', 'modified', 'deleted'].map((status) => ({ file: `${status}.md`, status, additions: 2, deletions: 1, patch: '@@ patch' })))
    mocks.client.mockResolvedValue({ session: { diff } })
    expect(await createOpenCodeV2Runtime('alice').sessionDiff('s1')).toEqual({ ok: true, data: ['added', 'modified', 'deleted'].map((status) => ({ path: `${status}.md`, status, additions: 2, deletions: 1, diff: '@@ patch' })) })
    expect(diff).toHaveBeenCalledWith({ sessionID: 's1' })
  })

  it.each(['createSession', 'deleteSession', 'listModels', 'listAgents', 'listConnectorKeys', 'listConnectorStatus', 'sessionDiff'] as const)('returns instance_unavailable from %s when no connection exists', async (operation) => {
    mocks.client.mockResolvedValue(null)
    const runtime = createOpenCodeV2Runtime('alice')
    const result = operation === 'createSession' ? await runtime.createSession() : await runtime[operation]('s1')
    expect(result).toEqual({ ok: false, error: { code: 'instance_unavailable' } })
  })

  it.each(['createSession', 'deleteSession', 'listModels', 'listAgents', 'listConnectorKeys', 'listConnectorStatus', 'sessionDiff'] as const)('converts expected native rejection from %s into a typed failure', async (operation) => {
    const reject = vi.fn().mockRejectedValue({ reason: 'Transport', message: 'Runtime disconnected' })
    mocks.client.mockResolvedValue({
      location: { get: vi.fn().mockResolvedValue({ directory: '/workspace' }) },
      session: { create: reject, remove: reject, diff: reject },
      model: { list: reject, default: vi.fn().mockResolvedValue({ data: null }) },
      agent: { list: reject }, mcp: { list: reject },
    })
    const runtime = createOpenCodeV2Runtime('alice')
    const result = operation === 'createSession' ? await runtime.createSession() : await runtime[operation]('s1')
    expect(result).toEqual({ ok: false, error: { code: 'fetch_failed', detail: 'Runtime disconnected' } })
    expect(reject).toHaveBeenCalledTimes(1)
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

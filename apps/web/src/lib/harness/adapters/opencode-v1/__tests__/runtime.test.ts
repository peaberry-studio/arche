import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { createOpenCodeV1Runtime, normalizeOpenCodeError } from '@/lib/harness/adapters/opencode-v1/runtime'

const mocks = vi.hoisted(() => ({ client: vi.fn(), configured: vi.fn(), health: vi.fn(), providers: vi.fn(), fresh: vi.fn(), auth: vi.fn(), events: vi.fn() }))
vi.mock('@/lib/harness/adapters/opencode-v1/client-factory', () => ({ createConfiguredOpencodeClient: mocks.configured }))
vi.mock('@/lib/harness/adapters/opencode-v1/client', () => ({ createInstanceClient: mocks.client, isInstanceHealthyWithPassword: mocks.health, getInstanceBasicAuth: mocks.auth, DEFAULT_HEALTH_TIMEOUT_MS: 5000 }))
vi.mock('@/lib/harness/adapters/opencode-v1/providers', () => ({ syncProviderAccessForInstance: mocks.providers, ensureProviderAccessFreshForExecution: mocks.fresh }))
vi.mock('@/lib/harness/adapters/opencode-v1/events', () => ({ subscribeOpenCodeEvents: mocks.events }))

describe('OpenCode v1 runtime', () => {
  beforeEach(() => { vi.clearAllMocks() })
  afterEach(() => { vi.unstubAllGlobals() })

  it('normalizes session records instead of leaking SDK fields', async () => {
    mocks.client.mockResolvedValue({ session: { list: vi.fn().mockResolvedValue({ data: [{ id: 's1', title: 'Hello', parentID: 'root', time: { created: 10, updated: 20 }, directory: '/workspace', version: 'sdk-version' }] }) } })
    const result = await createOpenCodeV1Runtime('alice').listSessions()
    expect(result.ok && result.data[0]).toMatchObject({ id: 's1', title: 'Hello', parentId: 'root', createdAtRaw: 10, updatedAtRaw: 20, status: 'idle' })
    expect(result.ok && result.data[0]).not.toHaveProperty('directory')
    expect(result.ok && result.data[0]).not.toHaveProperty('parentID')
  })

  it('reads archive sessions with explicit credentials while the serving instance is stopped', async () => {
    const connection = { baseUrl: 'http://archive:4096', authHeader: 'Basic fixture' }
    mocks.configured.mockResolvedValue({ session: { list: vi.fn().mockResolvedValue({ data: [] }) } })
    expect(await createOpenCodeV1Runtime('alice', connection).listSessions()).toEqual({ ok: true, data: [] })
    expect(mocks.configured).toHaveBeenCalledWith(connection)
    expect(mocks.client).not.toHaveBeenCalled()
  })

  it('normalizes message metadata, failures and parts', async () => {
    mocks.client.mockResolvedValue({ session: { messages: vi.fn().mockResolvedValue({ data: [{ info: { id: 'm1', role: 'assistant', providerID: 'openai', modelID: 'model', agent: 'reviewer', error: { name: 'ProviderAuthError', data: { message: 'Missing API key' } }, time: { created: 10 } }, parts: [{ id: 't1', callID: 'call1', type: 'tool', tool: 'bash', state: { status: 'running', input: {} } }] }] }) } })
    const result = await createOpenCodeV1Runtime('alice').listMessages('s1')
    expect(result.ok && result.data[0]).toMatchObject({ id: 'm1', sessionId: 's1', role: 'assistant', agentId: 'reviewer', model: { providerId: 'openai', modelId: 'model' }, error: { code: 'provider_auth_missing' }, parts: [{ type: 'tool', id: 'call1', name: 'bash' }] })
    expect(result.ok && result.data[0]).not.toHaveProperty('info')
  })

  it.each([404, '404'])('maps missing sessions from HTTP %s to a stable result', async (status) => {
    mocks.client.mockResolvedValue({ session: { get: vi.fn().mockRejectedValue({ status, message: 'Missing session' }) } })
    expect(await createOpenCodeV1Runtime('alice').getSession('missing')).toEqual({ ok: false, error: { code: 'session_not_found', detail: 'Missing session', status: 404 } })
  })

  it('preserves SDK-wrapped HTTP status from its error cause', async () => {
    mocks.client.mockResolvedValue({ permission: { reply: vi.fn().mockRejectedValue(new Error('permission missing', { cause: { body: { name: 'NotFoundError' }, status: 404 } })) } })
    expect(await createOpenCodeV1Runtime('alice').replyPermission({ sessionId: 's1', permissionId: 'p1', response: 'once' })).toEqual({ ok: false, error: { code: 'session_not_found', detail: 'permission missing', status: 404 } })
  })

  it('passes operation cancellation signals to the SDK', async () => {
    const promptAsync = vi.fn().mockResolvedValue({})
    const status = vi.fn().mockResolvedValue({ data: {} })
    const reply = vi.fn().mockResolvedValue({})
    mocks.client.mockResolvedValue({ session: { promptAsync, status }, permission: { reply } })
    const runtime = createOpenCodeV1Runtime('alice')
    const signal = new AbortController().signal
    await runtime.prompt({ sessionId: 's1', parts: [] }, { signal })
    await runtime.sessionStatus({ signal })
    await runtime.replyPermission({ sessionId: 's1', permissionId: 'p1', response: 'once' }, { signal })
    for (const operation of [promptAsync, status, reply]) expect(operation).toHaveBeenCalledWith(expect.anything(), { signal, throwOnError: true })
  })

  it.each(['SessionNotFoundError', 'session_not_found'])('maps runtime missing-session code %s', (name) => {
    expect(normalizeOpenCodeError({ name }).error.code).toBe('session_not_found')
  })

  it('preserves runtime failure detail without throwing', async () => {
    mocks.client.mockRejectedValue(new Error('transport down'))
    expect(await createOpenCodeV1Runtime('alice').listSessions()).toEqual({ ok: false, error: { code: 'runtime_error', detail: 'transport down' } })
  })

  it('normalizes configured agent models', async () => {
    mocks.client.mockResolvedValue({ app: { agents: vi.fn().mockResolvedValue({ data: [{ name: 'reviewer', model: { providerID: 'fireworks-ai', modelID: 'model' } }] }) } })
    expect(await createOpenCodeV1Runtime('alice').listAgents()).toEqual({ ok: true, data: [{ id: 'reviewer', name: 'reviewer', model: { providerId: 'fireworks', modelId: 'model' } }] })
  })

  it('normalizes connector readiness without exposing MCP status payloads', async () => {
    mocks.client.mockResolvedValue({
      config: { get: vi.fn().mockResolvedValue({ data: { mcp: { slack: {}, linear: {} } } }) },
      mcp: { status: vi.fn().mockResolvedValue({ data: { slack: { status: 'connected' }, linear: { status: 'needs_auth' } } }) },
    })
    const runtime = createOpenCodeV1Runtime('alice')
    expect(await runtime.listConnectorKeys()).toEqual({ ok: true, data: ['slack', 'linear'] })
    expect(await runtime.listConnectorStatus()).toEqual({ ok: true, data: { slack: true, linear: false } })
  })

  it('reports unavailable instances', async () => {
    mocks.client.mockResolvedValue(null)
    expect(await createOpenCodeV1Runtime('alice').listSessions()).toEqual({ ok: false, error: { code: 'instance_unavailable' } })
  })

  it.each([
    { reason: 'free_tier_limit', terminalError: 'free_tier_limit' },
    { reason: 'rate_limit', terminalError: undefined },
  ])('preserves retry classification for $reason', async ({ reason, terminalError }) => {
    mocks.client.mockResolvedValue({ session: { status: vi.fn().mockResolvedValue({ data: {
      s1: { type: 'retry', attempt: 2, message: 'Retrying', next: 123, action: { reason } },
    } }) } })

    expect(await createOpenCodeV1Runtime('alice').sessionStatus()).toEqual({ ok: true, data: {
      s1: { type: 'retry', attempt: 2, message: 'Retrying', next: 123, ...(terminalError && { terminalError }) },
    } })
  })

  it('translates prompt identifiers at the adapter boundary', async () => {
    const promptAsync = vi.fn().mockResolvedValue({})
    mocks.client.mockResolvedValue({ session: { promptAsync } })
    expect(await createOpenCodeV1Runtime('alice').prompt({ sessionId: 's1', agent: 'reviewer', model: { providerId: 'fireworks', modelId: 'model' }, parts: [{ type: 'text', text: 'Hello' }] })).toEqual({ ok: true, data: undefined })
    expect(promptAsync).toHaveBeenCalledWith({ sessionID: 's1', agent: 'reviewer', model: { providerID: 'fireworks-ai', modelID: 'model' }, parts: [{ type: 'text', text: 'Hello' }] }, { throwOnError: true })
  })

  it('preserves an explicit prompt message id', async () => {
    const promptAsync = vi.fn().mockResolvedValue({})
    mocks.client.mockResolvedValue({ session: { promptAsync } })
    await createOpenCodeV1Runtime('alice').prompt({ sessionId: 's1', messageId: 'message-explicit', parts: [{ type: 'text', text: 'Hello' }] })
    expect(promptAsync).toHaveBeenCalledWith(expect.objectContaining({ sessionID: 's1', messageID: 'message-explicit' }), { throwOnError: true })
  })

  it.each(['once', 'always', 'reject'] as const)('translates permission response %s', async (response) => {
    const reply = vi.fn().mockResolvedValue({ data: true })
    mocks.client.mockResolvedValue({ permission: { reply } })
    expect(await createOpenCodeV1Runtime('alice').replyPermission({ sessionId: 's1', permissionId: 'p1', response })).toEqual({ ok: true, data: undefined })
    expect(reply).toHaveBeenCalledWith({ requestID: 'p1', reply: response }, { throwOnError: true })
  })

  it.each([
    ['JSON', '{"info":{"id":"m1"},"parts":[{"type":"text","text":"Hello "},{"type":"text","text":"world"}]}'],
    ['NDJSON', '{"messageID":"m1","type":"text","text":"Hello "}\n{"type":"text","text":"world"}'],
  ])('preserves the synchronous legacy %s prompt response', async (_kind, body) => {
    mocks.auth.mockResolvedValue({ baseUrl: 'http://runtime', authHeader: 'Basic token' })
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(body)))
    const result = await createOpenCodeV1Runtime('alice').sendMessage({ sessionId: 's1', parts: [{ type: 'text', text: 'Hi' }] })
    expect(result.ok && result.data).toMatchObject({ id: 'm1', sessionId: 's1', content: 'Hello world', parts: [{ type: 'text', text: 'Hello world' }] })
  })

  it('maps explicit-password health timeouts to typed errors', async () => {
    mocks.health.mockResolvedValue({ ok: false, detail: 'healthcheck_timeout' })
    expect(await createOpenCodeV1Runtime('alice').health({ password: 'password', baseUrl: 'http://direct', timeoutMs: 10 })).toEqual({ ok: false, error: { code: 'healthcheck_timeout' } })
  })

  it('bounds SDK health probes with cancellation', async () => {
    vi.useFakeTimers()
    let signal: AbortSignal | undefined
    mocks.client.mockResolvedValue({ global: { health: vi.fn((options: { signal: AbortSignal }) => {
      signal = options.signal
      return new Promise((_resolve, reject) => options.signal.addEventListener('abort', () => reject(new Error('aborted')), { once: true }))
    }) } })
    try {
      const promise = createOpenCodeV1Runtime('alice').health({ timeoutMs: 100 })
      await vi.advanceTimersByTimeAsync(100)
      expect(await promise).toEqual({ ok: false, error: { code: 'healthcheck_timeout' } })
      expect(signal?.aborted).toBe(true)
    } finally {
      vi.useRealTimers()
    }
  })

  it.each(['dns_resolution_error', 'connection_refused', 'connect_timeout', 'fetch_failed', 'invalid_json', 'unhealthy_response', 'http_status_503'])('preserves startup health failure code %s', async (detail) => {
    mocks.health.mockResolvedValue({ ok: false, detail, message: 'failure detail' })
    expect(await createOpenCodeV1Runtime('alice').health({ password: 'password' })).toEqual({ ok: false, error: { code: detail, detail: 'failure detail' } })
  })

  it('syncs provider access with explicit pre-start credentials', async () => {
    mocks.providers.mockResolvedValue({ ok: true })
    const connection = { baseUrl: 'http://direct', authHeader: 'Basic token' }
    expect(await createOpenCodeV1Runtime('alice').syncProviderAccess({ userId: 'u1', connection, disposeInstance: false })).toEqual({ ok: true, data: undefined })
    expect(mocks.providers).toHaveBeenCalledWith({ instance: connection, slug: 'alice', userId: 'u1', disposeInstance: false })
  })

  it('refreshes provider access without SDK-shaped options', async () => {
    mocks.fresh.mockResolvedValue(undefined)
    expect(await createOpenCodeV1Runtime('alice').syncProviderAccess({ userId: 'u1', force: true, ignoreActiveRunId: 'r1' })).toEqual({ ok: true, data: undefined })
    expect(mocks.fresh).toHaveBeenCalledWith({ slug: 'alice', userId: 'u1', force: true, ignoreActiveRunId: 'r1' })
  })
})

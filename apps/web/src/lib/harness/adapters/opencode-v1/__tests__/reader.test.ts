import { beforeEach, describe, expect, it, vi } from 'vitest'

const createClient = vi.hoisted(() => vi.fn())
const healthWithPassword = vi.hoisted(() => vi.fn())
vi.mock('@/lib/harness/adapters/opencode-v1/client-factory', () => ({ createConfiguredOpencodeClient: createClient }))
vi.mock('@/lib/harness/adapters/opencode-v1/client', () => ({ isInstanceHealthyWithPassword: healthWithPassword }))
vi.mock('@/lib/harness/runtime-connection', () => ({ DEFAULT_HEALTH_TIMEOUT_MS: 5_000 }))

import { createOpenCodeV1Reader } from '@/lib/harness/adapters/opencode-v1/reader'

const connection = { baseUrl: 'http://opencode-alice:4096', authHeader: 'Basic fixture' }

function source(id: string, parentID?: string) {
  return { id, title: id, parentID, time: { created: 1_700_000_000_000, updated: 1_700_000_100_000 } }
}

describe('OpenCode 1 history reader', () => {
  const client = {
    global: { health: vi.fn() },
    session: { get: vi.fn(), list: vi.fn(), children: vi.fn(), status: vi.fn(), messages: vi.fn(), abort: vi.fn() },
  }

  beforeEach(() => {
    vi.clearAllMocks()
    createClient.mockResolvedValue(client)
  })

  it('reads sessions, children and messages through the bound connection', async () => {
    client.session.list.mockResolvedValue({ data: [source('root')] })
    client.session.children.mockResolvedValue({ data: [source('child', 'root')] })
    client.session.get.mockResolvedValue({ data: source('root') })
    client.session.messages.mockResolvedValue({ data: [
      { info: { id: 'm1', role: 'user', time: { created: 1_700_000_050_000 } }, parts: [{ id: 'p1', type: 'text', text: 'hello' }] },
      { info: { id: 'm2', role: 'tool' }, parts: [] },
    ] })
    const reader = createOpenCodeV1Reader('alice', connection)

    expect(await reader.listSessions({ rootsOnly: false, limit: 10 })).toMatchObject({ ok: true, data: [{ id: 'root', createdAtRaw: 1_700_000_000_000 }] })
    expect(client.session.list).toHaveBeenCalledWith({ limit: 10, roots: false, start: undefined }, { throwOnError: true })
    expect(await reader.listChildren('root')).toMatchObject({ ok: true, data: [{ id: 'child', parentId: 'root' }] })
    expect(await reader.getSession('root')).toMatchObject({ ok: true, data: { id: 'root' } })
    const messages = await reader.listMessages('root')
    expect(messages).toMatchObject({ ok: true, data: [{ id: 'm1', sessionId: 'root', role: 'user' }] })
    expect(messages.ok && messages.data).toHaveLength(1)
    expect(createClient).toHaveBeenCalledWith(connection)
  })

  it('reports every non-idle status, retries included, as busy', async () => {
    client.session.status.mockResolvedValue({ data: { a: { type: 'idle' }, b: { type: 'busy' }, c: { type: 'retry', attempt: 2 } } })
    const signal = new AbortController().signal
    expect(await createOpenCodeV1Reader('alice', connection).sessionStatus({ signal })).toEqual({
      ok: true, data: { a: { type: 'idle' }, b: { type: 'busy' }, c: { type: 'busy' } },
    })
    expect(client.session.status).toHaveBeenCalledWith({}, { throwOnError: true, signal })
  })

  it.each([
    [{ status: 404, message: 'missing' }, 'session_not_found'],
    [{ status: 409 }, 'session_busy'],
    [new Error('socket hang up'), 'runtime_error'],
  ])('maps a client failure %j to %s', async (error, code) => {
    client.session.abort.mockRejectedValue(error)
    expect(await createOpenCodeV1Reader('alice', connection).abortSession('root')).toMatchObject({ ok: false, error: { code } })
  })

  it('rejects a session without an id instead of archiving it', async () => {
    client.session.get.mockResolvedValue({ data: { title: 'no id' } })
    expect(await createOpenCodeV1Reader('alice', connection).getSession('x')).toMatchObject({ ok: false, error: { code: 'runtime_error' } })
  })

  it('probes an archive helper with explicit credentials', async () => {
    healthWithPassword.mockResolvedValueOnce({ ok: true }).mockResolvedValueOnce({ ok: false, detail: 'http_status_503', message: 'Service Unavailable' })
    const reader = createOpenCodeV1Reader('alice', connection)
    const options = { password: 'pw', baseUrl: 'http://10.0.0.2:4096', timeoutMs: 100 }
    expect(await reader.health(options)).toEqual({ ok: true, data: {} })
    expect(healthWithPassword).toHaveBeenCalledWith('alice', 'pw', 'http://10.0.0.2:4096', options)
    expect(await reader.health(options)).toEqual({ ok: false, error: { code: 'http_status_503', detail: 'Service Unavailable' } })
  })

  it('probes the bound connection without credentials and bounds the request', async () => {
    client.global.health.mockResolvedValueOnce({ data: { healthy: true, version: '1.18.18' } }).mockResolvedValueOnce({ data: { healthy: false } })
    const reader = createOpenCodeV1Reader('alice', connection)
    expect(await reader.health({ timeoutMs: 1_000 })).toEqual({ ok: true, data: { version: '1.18.18' } })
    expect(client.global.health).toHaveBeenCalledWith({ signal: expect.any(AbortSignal), throwOnError: true })
    expect(await reader.health()).toEqual({ ok: false, error: { code: 'unhealthy_response' } })
    expect(healthWithPassword).not.toHaveBeenCalled()
  })

  it('reports a timeout when the probe outlives its deadline', async () => {
    client.global.health.mockImplementation(({ signal }: { signal: AbortSignal }) => new Promise((_resolve, reject) => {
      signal.addEventListener('abort', () => reject(signal.reason), { once: true })
    }))
    expect(await createOpenCodeV1Reader('alice', connection).health({ timeoutMs: 5 })).toEqual({ ok: false, error: { code: 'healthcheck_timeout' } })
  })
})

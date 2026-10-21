import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { createOpenCodeV2Runtime } from '@/lib/harness/adapters/opencode-v2/runtime'
import { getEnabledProviderCredentialsForUser, type EnabledProviderCredentials } from '@/lib/providers/store'
import type { ProviderId } from '@/lib/providers/types'
import { instanceService, messageRunService } from '@/lib/services'

const mocks = vi.hoisted(() => ({ auth: vi.fn() }))
vi.mock('@/lib/harness/runtime-connection', () => ({
  getInstanceBasicAuth: mocks.auth,
  getInstanceUrl: (_slug: string, baseUrl?: string) => baseUrl ?? 'http://runtime',
}))
vi.mock('@/lib/providers/store', () => ({ getEnabledProviderCredentialsForUser: vi.fn() }))
vi.mock('@/lib/providers/config', () => ({ getGatewayTokenTtlSeconds: () => 3600 }))
vi.mock('@/lib/providers/tokens', () => ({
  issueGatewayToken: (input: { providerId: string; version: number }) => `synthetic-token:${input.providerId}:${input.version}`,
}))
vi.mock('@/lib/services', () => ({
  instanceService: { findProviderSyncBySlug: vi.fn(), setProviderSyncState: vi.fn() },
  messageRunService: { hasActiveRunForSlug: vi.fn() },
}))

type Credential = { id: string; integrationID: string; label: string; active: boolean; value: { type: 'key'; key: string; metadata?: Record<string, unknown> } }

// Emulates the 2.0.32 store semantics observed by the providers probe: one
// active entry per integration, activation on create, and removal of the
// active entry reactivating the newest remaining one.
function credentialServer(initial: Credential[] = []) {
  let credentials = [...initial]
  let nextId = 1
  const calls: string[] = []
  const reload = { fail: false }
  vi.stubGlobal('fetch', vi.fn(async (input: string | URL, options: RequestInit = {}) => {
    const url = new URL(input)
    const method = options.method ?? 'GET'
    expect(new Headers(options.headers).get('Authorization')).toBe('Basic fixture-only')
    calls.push(`${method} ${url.pathname}`)
    if (url.pathname === '/api/credential' && method === 'GET') return Response.json({ data: credentials })
    if (url.pathname === '/api/credential' && method === 'POST') {
      const body = JSON.parse(String(options.body))
      const entry: Credential = { id: `cred_new_${nextId++}`, integrationID: body.integrationID, label: body.label, active: body.activate === true, value: body.value }
      if (entry.active) credentials = credentials.map((item) => item.integrationID === entry.integrationID ? { ...item, active: false } : item)
      credentials.push(entry)
      return Response.json({ data: entry })
    }
    const removed = url.pathname.match(/^\/api\/credential\/([^/]+)$/)
    if (removed && method === 'DELETE') {
      const entry = credentials.find((item) => item.id === removed[1])
      credentials = credentials.filter((item) => item.id !== removed[1])
      const fallback = credentials.findLast((item) => item.integrationID === entry?.integrationID)
      if (entry?.active && fallback) fallback.active = true
      return new Response(null, { status: 204 })
    }
    if (url.pathname === '/api/location/reload') return reload.fail ? Response.json({ _tag: 'LocationUnavailable', message: 'unavailable' }, { status: 503 }) : new Response(null, { status: 204 })
    if (url.pathname === '/api/info') return Response.json({ version: '2.0.32', pid: 1, urls: [] })
    if (url.pathname === '/api/model') return Response.json({ location: { directory: '/workspace' }, data: [] })
    throw new Error(`Unexpected request: ${method} ${url.pathname}`)
  }))
  return { calls, reload, credentials: () => credentials }
}

function enabled(entries: Array<[ProviderId, number]> = []): EnabledProviderCredentials {
  return new Map(entries.map(([providerId, version]) => [providerId, { credentialId: `${providerId}-cred`, source: 'user', version }]))
}

const foreign = (id: string, integrationID: string, active = true): Credential => ({ id, integrationID, label: 'user added', active, value: { type: 'key', key: `foreign-secret-${id}` } })

describe('V2 provider access sync through the real adapter and client', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.auth.mockResolvedValue({ baseUrl: 'http://runtime', authHeader: 'Basic fixture-only' })
    vi.mocked(getEnabledProviderCredentialsForUser).mockResolvedValue(enabled([['openai', 3]]))
    vi.mocked(instanceService.findProviderSyncBySlug).mockResolvedValue({ providerSyncHash: null, providerSyncedAt: null, status: 'running' })
    vi.mocked(messageRunService.hasActiveRunForSlug).mockResolvedValue(false)
  })
  afterEach(() => { vi.unstubAllGlobals() })

  it('replaces managed credentials with scoped gateway tokens, reloads and records freshness', async () => {
    const server = credentialServer([
      { id: 'cred_old_inactive', integrationID: 'openai', label: 'arche-managed:openai', active: false, value: { type: 'key', key: 'stale-1' } },
      { id: 'cred_old_active', integrationID: 'openai', label: 'arche-managed:openai', active: true, value: { type: 'key', key: 'stale-2' } },
      foreign('cred_user_openai', 'openai', false),
      foreign('cred_fireworks_alias', 'fireworks'),
      foreign('cred_github', 'github'),
      { id: 'cred_retired', integrationID: 'retired-provider', label: 'arche-managed:retired-provider', active: true, value: { type: 'key', key: 'stale-3' } },
    ])
    const log = vi.spyOn(console, 'error').mockImplementation(() => undefined)

    expect(await createOpenCodeV2Runtime('alice').syncProviderAccess({ userId: 'user-1', force: true })).toEqual({ ok: true, data: undefined })

    expect(server.credentials().map(({ integrationID, label, active, value }) => ({ integrationID, label, active, key: value.key }))).toEqual([
      { integrationID: 'github', label: 'user added', active: true, key: 'foreign-secret-cred_github' },
      { integrationID: 'openai', label: 'arche-managed:openai', active: true, key: 'synthetic-token:openai:3' },
      { integrationID: 'opencode', label: 'arche-managed:opencode', active: true, key: 'synthetic-token:opencode:0' },
    ])
    // The Zen token is never sent to the OpenCode Console: its Console server is Arche.
    expect(server.credentials().map(({ integrationID, value }) => [integrationID, value.metadata])).toEqual([
      ['github', undefined],
      ['openai', undefined],
      ['opencode', { server: 'http://web:3000/api/internal/opencode-console' }],
    ])
    const firstRemoval = server.calls.findIndex((call) => call.startsWith('DELETE'))
    expect(server.calls.lastIndexOf('POST /api/credential')).toBeLessThan(firstRemoval)
    expect(server.calls.slice(-3)).toEqual(['POST /api/location/reload', 'GET /api/info', 'GET /api/model'])
    expect(instanceService.setProviderSyncState).toHaveBeenCalledWith('alice', expect.stringMatching(/^[a-f0-9]{64}$/), expect.any(Date))
    expect(log).not.toHaveBeenCalled()
  })

  it('removes inactive entries before the active one when a provider is revoked, so nothing falls back', async () => {
    vi.mocked(getEnabledProviderCredentialsForUser).mockResolvedValue(enabled())
    const server = credentialServer([
      { id: 'cred_a', integrationID: 'anthropic', label: 'arche-managed:anthropic', active: true, value: { type: 'key', key: 'stale-a' } },
      foreign('cred_b', 'anthropic', false),
    ])
    expect(await createOpenCodeV2Runtime('alice').syncProviderAccess({ userId: 'user-1', force: true })).toEqual({ ok: true, data: undefined })
    expect(server.credentials().map(({ integrationID }) => integrationID)).toEqual(['opencode'])
    expect(server.calls.filter((call) => call.startsWith('DELETE'))).toEqual(['DELETE /api/credential/cred_b', 'DELETE /api/credential/cred_a'])
  })

  it('skips refresh while the recorded hash and TTL are still fresh', async () => {
    const server = credentialServer()
    const { createHash } = await import('node:crypto')
    const hash = createHash('sha256').update(JSON.stringify([{ credentialId: 'openai-cred', providerId: 'openai', source: 'user', version: 3 }])).digest('hex')
    vi.mocked(instanceService.findProviderSyncBySlug).mockResolvedValue({ providerSyncHash: hash, providerSyncedAt: new Date(), status: 'running' })
    expect(await createOpenCodeV2Runtime('alice').syncProviderAccess({ userId: 'user-1' })).toEqual({ ok: true, data: undefined })
    expect(server.calls).toEqual([])
    expect(instanceService.setProviderSyncState).not.toHaveBeenCalled()
  })

  it('defers an execution refresh while another run is active, without touching the store', async () => {
    const server = credentialServer()
    vi.mocked(messageRunService.hasActiveRunForSlug).mockResolvedValue(true)
    vi.spyOn(console, 'warn').mockImplementation(() => undefined)
    expect(await createOpenCodeV2Runtime('alice').syncProviderAccess({ userId: 'user-1', force: true, ignoreActiveRunId: 'run-1' })).toEqual({ ok: true, data: undefined })
    expect(messageRunService.hasActiveRunForSlug).toHaveBeenCalledWith('alice', { ignoreRunId: 'run-1' })
    expect(server.calls).toEqual([])
    expect(instanceService.setProviderSyncState).not.toHaveBeenCalled()
  })

  it('updates credentials for an explicit connection but defers the reload and freshness when a run starts', async () => {
    const server = credentialServer()
    vi.mocked(messageRunService.hasActiveRunForSlug).mockResolvedValue(true)
    vi.spyOn(console, 'warn').mockImplementation(() => undefined)
    expect(await createOpenCodeV2Runtime('alice').syncProviderAccess({ userId: 'user-1', connection: { baseUrl: 'http://runtime', authHeader: 'Basic fixture-only' } })).toEqual({ ok: true, data: undefined })
    expect(server.credentials().map(({ integrationID }) => integrationID)).toEqual(['openai', 'opencode'])
    expect(server.calls).not.toContain('POST /api/location/reload')
    expect(instanceService.setProviderSyncState).not.toHaveBeenCalled()
    expect(mocks.auth).not.toHaveBeenCalled()
  })

  it('records freshness without reloading when the caller disables the reload', async () => {
    const server = credentialServer()
    expect(await createOpenCodeV2Runtime('alice').syncProviderAccess({ userId: 'user-1', disposeInstance: false })).toEqual({ ok: true, data: undefined })
    expect(server.calls).not.toContain('POST /api/location/reload')
    expect(instanceService.setProviderSyncState).toHaveBeenCalledOnce()
  })

  it('fails without recording freshness or logging key material when the reload fails', async () => {
    const server = credentialServer([foreign('cred_user_openai', 'openai')])
    server.reload.fail = true
    const log = vi.spyOn(console, 'error').mockImplementation(() => undefined)
    const result = await createOpenCodeV2Runtime('alice').syncProviderAccess({ userId: 'user-1', force: true })
    expect(result).toMatchObject({ ok: false, error: { code: 'sync_failed' } })
    expect(instanceService.setProviderSyncState).not.toHaveBeenCalled()
    const logged = JSON.stringify(log.mock.calls)
    expect(logged).not.toContain('synthetic-token')
    expect(logged).not.toContain('foreign-secret')
  })

  it('serializes overlapping refreshes for one workspace', async () => {
    const server = credentialServer()
    const runtime = createOpenCodeV2Runtime('alice')
    const results = await Promise.all([runtime.syncProviderAccess({ userId: 'user-1', force: true }), runtime.syncProviderAccess({ userId: 'user-1', force: true })])
    expect(results).toEqual([{ ok: true, data: undefined }, { ok: true, data: undefined }])
    const reloads = server.calls.flatMap((call, index) => call === 'POST /api/location/reload' ? [index] : [])
    const secondSyncStart = server.calls.indexOf('POST /api/credential', reloads[0])
    expect(reloads).toHaveLength(2)
    expect(secondSyncStart).toBeGreaterThan(reloads[0])
    expect(server.credentials().map(({ integrationID }) => integrationID)).toEqual(['openai', 'opencode'])
  })

  it('reports an unavailable instance without contacting the runtime', async () => {
    mocks.auth.mockResolvedValue(null)
    const server = credentialServer()
    expect(await createOpenCodeV2Runtime('alice').syncProviderAccess({ userId: 'user-1', force: true })).toEqual({ ok: false, error: { code: 'instance_unavailable' } })
    expect(server.calls).toEqual([])
  })
})

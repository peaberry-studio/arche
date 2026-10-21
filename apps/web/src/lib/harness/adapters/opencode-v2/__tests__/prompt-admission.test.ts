import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { createOpenCodeV2Runtime } from '@/lib/harness/adapters/opencode-v2/runtime'

vi.mock('@/lib/harness/runtime-connection', () => ({ getInstanceBasicAuth: async () => ({ baseUrl: 'http://runtime', authHeader: 'Basic fixture-only' }) }))
vi.mock('@/lib/runtime/mode', () => ({ isDesktop: () => true }))
vi.mock('@/lib/runtime/desktop/context-store', () => ({ getDesktopVaultRuntimeContext: () => ({ vaultRoot: '/tmp' }) }))

describe('V2 prompt admission with the real client and submission lock', () => {
  beforeEach(() => { vi.clearAllMocks() })
  afterEach(() => { vi.unstubAllGlobals() })

  it('prevents concurrent model and agent changes from crossing between prompt submissions', async () => {
    const switching = Promise.withResolvers<void>()
    const release = Promise.withResolvers<void>()
    const calls: string[] = []
    const selected = { agent: 'initial', model: { providerID: 'fixture', id: 'initial' } }
    let active = false
    vi.stubGlobal('fetch', async (url: string, options: RequestInit = {}) => {
      const path = new URL(url).pathname
      const body = typeof options.body === 'string' ? JSON.parse(options.body) : undefined
      calls.push(path)
      if (path === '/api/session/session') return Response.json({ data: { id: 'session', ...selected } })
      if (path === '/api/session/active') return Response.json({ data: active ? { session: { type: 'running' } } : {} })
      if (path.endsWith('/agent')) {
        selected.agent = body.agent
        switching.resolve()
        await release.promise
        return new Response(null, { status: 204 })
      }
      if (path.endsWith('/model')) {
        selected.model = body.model
        return new Response(null, { status: 204 })
      }
      if (path.endsWith('/prompt')) {
        expect(selected).toEqual({ agent: 'a', model: { providerID: 'fixture', id: 'a' } })
        active = true
        return Response.json({ data: { id: 'msg_a' } })
      }
      throw new Error(`Unexpected request ${path}`)
    })
    const input = (id: string) => ({ sessionId: 'session', agent: id, model: { providerId: 'fixture', modelId: id }, parts: [{ type: 'text' as const, text: id }] })
    const first = createOpenCodeV2Runtime('alice').prompt(input('a'))
    await switching.promise
    expect(await createOpenCodeV2Runtime('alice').prompt(input('b'))).toMatchObject({ ok: false, error: { code: 'session_busy' } })
    release.resolve()
    expect(await first).toEqual({ ok: true, data: undefined })
    expect(await createOpenCodeV2Runtime('alice').prompt(input('b'))).toMatchObject({ ok: false, error: { code: 'session_busy' } })
    expect(calls.filter((path) => path.endsWith('/agent'))).toHaveLength(1)
    expect(calls.filter((path) => path.endsWith('/model'))).toHaveLength(1)
    expect(calls.filter((path) => path.endsWith('/prompt'))).toHaveLength(1)
  })
})

import { fetch as transportFetch, MockAgent } from 'undici'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('node:dns/promises', () => ({ lookup: vi.fn(async () => [{ address: '8.8.8.8', family: 4 }]) }))

import { loadConnectorToolInventory } from '@/lib/connectors/tool-inventory'
import { requestUmamiJson } from '@/lib/connectors/umami-client'

const targets = ['http://169.254.169.254/latest/meta-data/', 'http://docker-socket-proxy:2375/containers/web/json']
const secret = { token: 'internal-fixture', result: { tools: [{ name: 'internal_fixture' }] } }

describe('connector redirect containment', () => {
  let agent: MockAgent
  let internalRequest: ReturnType<typeof vi.fn>

  beforeEach(() => {
    agent = new MockAgent()
    agent.disableNetConnect()
    internalRequest = vi.fn(() => ({ statusCode: 200, data: JSON.stringify(secret), responseOptions: { headers: { 'content-type': 'application/json' } } }))
    vi.stubGlobal('fetch', vi.fn((url: string | URL, init: RequestInit = {}) => transportFetch(String(url), {
      method: init.method,
      headers: Object.fromEntries(new Headers(init.headers)),
      body: typeof init.body === 'string' ? init.body : undefined,
      signal: init.signal,
      redirect: init.redirect,
      dispatcher: agent,
    })))
  })
  afterEach(async () => { vi.unstubAllGlobals(); await agent.close() })

  function redirect(path: string, method: string, status: number, target: string) {
    agent.get('https://redirect.example').intercept({ path, method }).reply(status, '', { headers: { location: target } })
    const destination = new URL(target)
    agent.get(destination.origin).intercept({ path: destination.pathname, method: /.*/ }).reply(internalRequest)
  }

  it('proves the transport fixture follows an unsafe redirect without protection', async () => {
    redirect('/api/websites', 'GET', 302, targets[0])
    const response = await fetch('https://redirect.example/api/websites')
    expect(await response.json()).toEqual(secret)
    expect(internalRequest).toHaveBeenCalledOnce()
  })

  for (const target of targets) {
    for (const status of [302, 307]) {
      it(`rejects Umami API ${status} to ${target}`, async () => {
        redirect('/api/websites', 'GET', status, target)
        const result = await requestUmamiJson({ config: { authMethod: 'api-key', baseUrl: 'https://redirect.example/api/', apiKey: 'fixture' }, path: 'websites' })
        expect(result.ok).toBe(false)
        expect(internalRequest).not.toHaveBeenCalled()
        expect(fetch).toHaveBeenCalledWith(expect.any(String), expect.objectContaining({ redirect: 'error', dispatcher: expect.anything() }))
      })

      it(`rejects Umami login ${status} to ${target}`, async () => {
        redirect('/api/auth/login', 'POST', status, target)
        const result = await requestUmamiJson({ config: { authMethod: 'login', baseUrl: 'https://redirect.example/api/', username: `${status}-${new URL(target).hostname}`, password: 'fixture' }, path: 'websites' })
        expect(result.ok).toBe(false)
        expect(internalRequest).not.toHaveBeenCalled()
      })

      it(`rejects custom tool discovery ${status} to ${target}`, async () => {
        redirect('/mcp', 'POST', status, target)
        const result = await loadConnectorToolInventory({ type: 'custom', config: { endpoint: 'https://redirect.example/mcp', apiKey: 'fixture' } })
        expect(result.ok).toBe(false)
        expect(internalRequest).not.toHaveBeenCalled()
        expect(fetch).toHaveBeenCalledWith(expect.any(String), expect.objectContaining({ redirect: 'error', dispatcher: expect.anything() }))
      })
    }
  }
})

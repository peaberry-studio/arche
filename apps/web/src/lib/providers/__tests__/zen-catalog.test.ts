import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const GATEWAY = 'http://web:3000/api/internal/providers'

function upstreamCatalog() {
  return {
    opencode: {
      id: 'opencode',
      api: 'https://opencode.ai/inference/openai/v1',
      models: {
        'minimax-free': { id: 'minimax-free', provider: { api: 'https://opencode.ai/inference/openai/v1' } },
        claude: { id: 'claude', provider: { npm: '@ai-sdk/anthropic', api: 'https://opencode.ai/inference/anthropic/v1' } },
        plain: { id: 'plain' },
      },
    },
    'opencode-go': {
      id: 'opencode-go',
      api: 'https://opencode.ai/inference/go/openai/v1',
      models: { kimi: { id: 'kimi', provider: { api: 'https://opencode.ai/inference/go/google/v1beta' } } },
    },
    openrouter: { id: 'openrouter', api: 'https://openrouter.ai/api/v1', models: { x: { id: 'x', provider: { api: 'https://opencode.ai/inference/openai/v1' } } } },
  }
}

async function loadModule() {
  vi.resetModules()
  return import('@/lib/providers/zen-catalog')
}

describe('Zen model catalog for OpenCode 2', () => {
  let fetchMock: ReturnType<typeof vi.fn>

  beforeEach(() => {
    vi.useFakeTimers()
    fetchMock = vi.fn(async () => Response.json(upstreamCatalog()))
    vi.stubGlobal('fetch', fetchMock)
  })

  afterEach(() => {
    vi.useRealTimers()
    vi.unstubAllGlobals()
  })

  it('routes Zen and Go endpoints through the gateway and leaves everything else untouched', async () => {
    const { rewriteZenCatalog } = await loadModule()
    const rewritten = rewriteZenCatalog(upstreamCatalog(), `${GATEWAY}/`)

    expect(rewritten).toEqual({
      ...upstreamCatalog(),
      opencode: {
        id: 'opencode',
        api: `${GATEWAY}/opencode/inference/openai/v1`,
        models: {
          'minimax-free': { id: 'minimax-free', provider: { api: `${GATEWAY}/opencode/inference/openai/v1` } },
          claude: { id: 'claude', provider: { npm: '@ai-sdk/anthropic', api: `${GATEWAY}/opencode/inference/anthropic/v1` } },
          plain: { id: 'plain' },
        },
      },
      'opencode-go': {
        id: 'opencode-go',
        api: `${GATEWAY}/opencode-go/inference/go/openai/v1`,
        models: { kimi: { id: 'kimi', provider: { api: `${GATEWAY}/opencode-go/inference/go/google/v1beta` } } },
      },
    })
  })

  it('fetches upstream once per TTL, shares concurrent loads and caches each rendering', async () => {
    const { getGatewayModelsCatalog } = await loadModule()

    const [first, second] = await Promise.all([getGatewayModelsCatalog(GATEWAY), getGatewayModelsCatalog(GATEWAY)])
    expect(first).toEqual(second)
    expect(first.ok && JSON.parse(first.data).opencode.api).toBe(`${GATEWAY}/opencode/inference/openai/v1`)
    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect(fetchMock).toHaveBeenCalledWith('https://models.opencode.ai/api.json', expect.any(Object))

    const desktop = await getGatewayModelsCatalog('http://127.0.0.1:3000/api/internal/providers')
    expect(desktop.ok && JSON.parse(desktop.data).opencode.api).toBe('http://127.0.0.1:3000/api/internal/providers/opencode/inference/openai/v1')
    expect(fetchMock).toHaveBeenCalledTimes(1)

    vi.advanceTimersByTime(5 * 60_000)
    await getGatewayModelsCatalog(GATEWAY)
    expect(fetchMock).toHaveBeenCalledTimes(2)
  })

  it('serves the last good catalog while upstream fails and reports when there is none', async () => {
    const { getGatewayModelsCatalog } = await loadModule()
    fetchMock.mockResolvedValueOnce(new Response('down', { status: 503 }))
    expect(await getGatewayModelsCatalog(GATEWAY)).toEqual({ ok: false, error: 'catalog_unavailable' })

    vi.advanceTimersByTime(15_000)
    const fresh = await getGatewayModelsCatalog(GATEWAY)
    expect(fresh.ok).toBe(true)

    vi.advanceTimersByTime(5 * 60_000)
    fetchMock.mockRejectedValueOnce(new Error('network down'))
    expect(await getGatewayModelsCatalog(GATEWAY)).toEqual(fresh)
  })

  it('does not wait on upstream again for every start right after a failure', async () => {
    const { getGatewayModelsCatalog } = await loadModule()
    fetchMock.mockRejectedValue(new Error('network down'))
    expect(await getGatewayModelsCatalog(GATEWAY)).toEqual({ ok: false, error: 'catalog_unavailable' })
    expect(await getGatewayModelsCatalog(GATEWAY)).toEqual({ ok: false, error: 'catalog_unavailable' })
    expect(fetchMock).toHaveBeenCalledTimes(1)

    vi.advanceTimersByTime(15_000)
    fetchMock.mockResolvedValue(Response.json(upstreamCatalog()))
    expect((await getGatewayModelsCatalog(GATEWAY)).ok).toBe(true)
    expect(fetchMock).toHaveBeenCalledTimes(2)
  })

  it('falls back to a previously rendered gateway-safe catalog when this process has none', async () => {
    const { getGatewayModelsCatalog, rewriteZenCatalog } = await loadModule()
    const previous = JSON.stringify(rewriteZenCatalog(upstreamCatalog(), GATEWAY))
    fetchMock.mockRejectedValue(new Error('network down'))
    expect(await getGatewayModelsCatalog(GATEWAY, previous)).toEqual({ ok: true, data: previous })
  })

  type Rewrite = (catalog: Record<string, unknown>, gatewayRoot: string) => Record<string, unknown>
  it.each([
    ['an unrewritten catalog', () => JSON.stringify(upstreamCatalog())],
    ['a catalog rendered for another gateway', (rewrite: Rewrite) => JSON.stringify(rewrite(upstreamCatalog(), 'http://other:3000/api/internal/providers'))],
    ['a catalog without the Go provider', (rewrite: Rewrite) => JSON.stringify({ ...rewrite(upstreamCatalog(), GATEWAY), 'opencode-go': undefined })],
    ['a catalog with one model left on opencode.ai', (rewrite: Rewrite) => {
      const rendered = rewrite(upstreamCatalog(), GATEWAY) as { opencode: { models: Record<string, unknown> } }
      rendered.opencode.models.leak = { id: 'leak', provider: { api: 'https://opencode.ai/inference/openai/v1' } }
      return JSON.stringify(rendered)
    }],
    ['invalid JSON', () => '{'],
  ])('never falls back to %s', async (_label, previous) => {
    const { getGatewayModelsCatalog, rewriteZenCatalog } = await loadModule()
    fetchMock.mockRejectedValue(new Error('network down'))
    expect(await getGatewayModelsCatalog(GATEWAY, previous(rewriteZenCatalog))).toEqual({ ok: false, error: 'catalog_unavailable' })
  })

  it.each([
    {},
    { ...upstreamCatalog(), opencode: undefined },
    { ...upstreamCatalog(), 'opencode-go': { ...upstreamCatalog()['opencode-go'], models: {} } },
    { ...upstreamCatalog(), opencode: { ...upstreamCatalog().opencode, api: 'https://external.invalid/v1' } },
    { ...upstreamCatalog(), opencode: { ...upstreamCatalog().opencode, models: { unsafe: { provider: { api: 'https://opencode.ai.evil.invalid/inference/openai/v1' } } } } },
  ])('refuses an incomplete or unrewritable boot catalog (%j)', async (catalog) => {
    const { getGatewayModelsCatalog } = await loadModule()
    fetchMock.mockResolvedValueOnce(Response.json(catalog))
    expect(await getGatewayModelsCatalog(GATEWAY)).toEqual({ ok: false, error: 'catalog_unavailable' })
  })
})

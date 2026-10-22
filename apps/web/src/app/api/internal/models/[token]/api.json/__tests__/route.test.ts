import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  getGatewayModelsCatalog: vi.fn(),
  isDesktop: vi.fn(() => false),
}))

vi.mock('@/lib/providers/zen-catalog', () => ({ getGatewayModelsCatalog: mocks.getGatewayModelsCatalog }))
vi.mock('@/lib/runtime/mode', () => ({ isDesktop: mocks.isDesktop }))

import { GET } from '@/app/api/internal/models/[token]/api.json/route'
import { getModelsCatalogToken } from '@/lib/providers/models-catalog-token'
import { issueGatewayToken } from '@/lib/providers/tokens'
import { getRuntimeModelsCatalogUrl } from '@/lib/runtime/internal-api'

function requestCatalog(baseUrl = getRuntimeModelsCatalogUrl()) {
  const request = new Request(`${baseUrl}/api.json`)
  const token = new URL(request.url).pathname.split('/').at(-2) ?? ''
  return GET(request, { params: Promise.resolve({ token }) })
}

describe('/api/internal/models/[token]/api.json', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.stubEnv('ARCHE_GATEWAY_TOKEN_SECRET', 'fixture')
    vi.stubEnv('ARCHE_DESKTOP_WEB_PORT', '4321')
    mocks.isDesktop.mockReturnValue(false)
    mocks.getGatewayModelsCatalog.mockResolvedValue({ ok: true, data: '{"opencode":{}}' })
  })
  afterEach(() => { vi.unstubAllEnvs(); vi.useRealTimers() })

  it.each([
    ['web', false, 'http://web:3000/api/internal'],
    ['desktop', true, 'http://127.0.0.1:4321/api/internal'],
  ] as const)('serves a headerless %s runtime fetch using its scoped catalog URL', async (_mode, desktop, root) => {
    mocks.isDesktop.mockReturnValue(desktop)
    expect(getRuntimeModelsCatalogUrl()).toBe(`${root}/models/${getModelsCatalogToken()}`)

    const res = await requestCatalog()

    expect(res.status).toBe(200)
    expect(res.headers.get('content-type')).toBe('application/json')
    expect(res.headers.get('cache-control')).toBe('no-store')
    expect(await res.text()).toBe('{"opencode":{}}')
    expect(mocks.getGatewayModelsCatalog).toHaveBeenCalledWith(`${root}/providers`)
  })

  it.each(['bad', 'x'.repeat(43)])('rejects an invalid token before catalog loading: %s', async (token) => {
    const res = await requestCatalog(`http://public.example/api/internal/models/${token}`)

    expect(res.status).toBe(401)
    expect(await res.json()).toEqual({ error: 'unauthorized' })
    expect(mocks.getGatewayModelsCatalog).not.toHaveBeenCalled()
  })

  it('rejects provider gateway tokens before catalog loading', async () => {
    const token = issueGatewayToken({ userId: 'user-1', workspaceSlug: 'alice', providerId: 'openai', version: 1 })
    const res = await requestCatalog(`http://public.example/api/internal/models/${token}`)

    expect(res.status).toBe(401)
    expect(mocks.getGatewayModelsCatalog).not.toHaveBeenCalled()
  })

  it('keeps the spawned URL valid for later runtime catalog refreshes', async () => {
    vi.useFakeTimers()
    const baseUrl = getRuntimeModelsCatalogUrl()
    expect((await requestCatalog(baseUrl)).status).toBe(200)
    vi.setSystemTime(Date.now() + 7 * 24 * 60 * 60_000)

    expect((await requestCatalog(baseUrl)).status).toBe(200)
  })

  it('returns 502 to an authenticated runtime when no catalog is available', async () => {
    mocks.getGatewayModelsCatalog.mockResolvedValue({ ok: false, error: 'catalog_unavailable' })

    const res = await requestCatalog()

    expect(res.status).toBe(502)
    expect(await res.json()).toEqual({ error: 'catalog_unavailable' })
  })
})

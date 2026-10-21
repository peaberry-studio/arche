import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  getGatewayModelsCatalog: vi.fn(),
  getRuntimeInternalApiRoot: vi.fn(() => 'http://web:3000/api/internal'),
}))

vi.mock('@/lib/providers/zen-catalog', () => ({ getGatewayModelsCatalog: mocks.getGatewayModelsCatalog }))
vi.mock('@/lib/runtime/internal-api', () => ({ getRuntimeInternalApiRoot: mocks.getRuntimeInternalApiRoot }))

import { GET } from '../route'

describe('/api/internal/models/api.json', () => {
  beforeEach(() => { vi.clearAllMocks() })

  it('serves the catalog rendered for the runtime-facing gateway root', async () => {
    mocks.getGatewayModelsCatalog.mockResolvedValue({ ok: true, data: '{"opencode":{}}' })

    const res = await GET()

    expect(mocks.getGatewayModelsCatalog).toHaveBeenCalledWith('http://web:3000/api/internal/providers')
    expect(res.status).toBe(200)
    expect(res.headers.get('content-type')).toBe('application/json')
    expect(await res.text()).toBe('{"opencode":{}}')
  })

  it('returns 502 when no catalog is available', async () => {
    mocks.getGatewayModelsCatalog.mockResolvedValue({ ok: false, error: 'catalog_unavailable' })

    const res = await GET()

    expect(res.status).toBe(502)
    expect(await res.json()).toEqual({ error: 'catalog_unavailable' })
  })
})

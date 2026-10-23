import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  getGatewayModelsCatalog: vi.fn(),
}))

vi.mock('@/lib/providers/zen-catalog', () => ({ getGatewayModelsCatalog: mocks.getGatewayModelsCatalog }))

import { GET } from '@/app/api/internal/models/api.json/route'

describe('/api/internal/models/api.json', () => {
  beforeEach(() => { vi.clearAllMocks() })

  it('rejects anonymous requests before loading or fetching the catalog', async () => {
    mocks.getGatewayModelsCatalog.mockResolvedValue({ ok: true, data: '{"opencode":{}}' })

    const res = await GET()

    expect(res.status).toBe(401)
    expect(await res.json()).toEqual({ error: 'unauthorized' })
    expect(mocks.getGatewayModelsCatalog).not.toHaveBeenCalled()
  })
})

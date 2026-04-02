import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@/lib/services', () => ({
  patService: {
    findByLookupHash: vi.fn(),
    touchLastUsed: vi.fn(),
  },
}))

vi.mock('@/lib/mcp/pat', () => ({
  PAT_PREFIX: 'arche_pat_',
  hasPatPrefix: vi.fn((token: string) => token.startsWith('arche_pat_')),
  hashPatLookup: vi.fn((token: string) => `lookup_${token}`),
  verifyPat: vi.fn(() => true),
}))

vi.mock('@/lib/runtime/capabilities', () => ({
  getRuntimeCapabilities: vi.fn(() => ({ mcp: true })),
}))

import { patService } from '@/lib/services'
import {
  hasPatPrefix,
  hashPatLookup,
  verifyPat,
} from '@/lib/mcp/pat'
import { getRuntimeCapabilities } from '@/lib/runtime/capabilities'
import { authenticatePat } from '../auth'

const mockFindByLookupHash = vi.mocked(patService.findByLookupHash)
const mockTouchLastUsed = vi.mocked(patService.touchLastUsed)
const mockHasPatPrefix = vi.mocked(hasPatPrefix)
const mockHashPatLookup = vi.mocked(hashPatLookup)
const mockVerifyPat = vi.mocked(verifyPat)
const mockGetCaps = vi.mocked(getRuntimeCapabilities)

function makeRequest(authorization?: string): Request {
  const headers = new Headers()
  if (authorization) {
    headers.set('Authorization', authorization)
  }

  return new Request('http://localhost/api/mcp', {
    method: 'POST',
    headers,
  })
}

describe('authenticatePat', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockGetCaps.mockReturnValue({ mcp: true } as never)
    mockHasPatPrefix.mockImplementation((token: string) => token.startsWith('arche_pat_'))
    mockHashPatLookup.mockImplementation((token: string) => `lookup_${token}`)
    mockVerifyPat.mockReturnValue(true)
    mockTouchLastUsed.mockResolvedValue({} as never)
  })

  it('rejects when mcp capability is disabled', async () => {
    mockGetCaps.mockReturnValue({ mcp: false } as never)

    const result = await authenticatePat(makeRequest('Bearer arche_pat_x'))

    expect(result).toMatchObject({ ok: false, status: 401 })
  })

  it('rejects when Authorization header is missing', async () => {
    const result = await authenticatePat(makeRequest())

    expect(result).toMatchObject({ ok: false, status: 401 })
  })

  it('rejects when Authorization is not Bearer scheme', async () => {
    const result = await authenticatePat(makeRequest('Basic abc'))

    expect(result).toMatchObject({ ok: false, status: 401 })
  })

  it('rejects when token does not have arche_pat_ prefix', async () => {
    const result = await authenticatePat(makeRequest('Bearer some_random_token'))

    expect(result).toMatchObject({ ok: false, status: 401 })
  })

  it('rejects when token is not found in DB', async () => {
    mockFindByLookupHash.mockResolvedValue(null)

    const result = await authenticatePat(makeRequest('Bearer arche_pat_abc'))

    expect(mockFindByLookupHash).toHaveBeenCalledWith('lookup_arche_pat_abc')
    expect(result).toMatchObject({ ok: false, status: 401 })
  })

  it('rejects when the stored salted hash does not match', async () => {
    mockFindByLookupHash.mockResolvedValue({
      id: 'tok-1',
      userId: 'u1',
      tokenHash: 'stored-hash',
      salt: 'a'.repeat(32),
      expiresAt: new Date(Date.now() + 86400000),
      revokedAt: null,
      user: { id: 'u1', email: 'a@b.com', slug: 'alice', role: 'USER' },
    } as never)
    mockVerifyPat.mockReturnValue(false)

    const result = await authenticatePat(makeRequest('Bearer arche_pat_abc'))

    expect(result).toMatchObject({ ok: false, status: 401 })
  })

  it('rejects when token is revoked', async () => {
    mockFindByLookupHash.mockResolvedValue({
      id: 'tok-1',
      userId: 'u1',
      tokenHash: 'stored-hash',
      salt: 'a'.repeat(32),
      expiresAt: new Date(Date.now() + 86400000),
      revokedAt: new Date(),
      user: { id: 'u1', email: 'a@b.com', slug: 'alice', role: 'USER' },
    } as never)

    const result = await authenticatePat(makeRequest('Bearer arche_pat_abc'))

    expect(result).toMatchObject({ ok: false, status: 401 })
  })

  it('rejects when token is expired', async () => {
    mockFindByLookupHash.mockResolvedValue({
      id: 'tok-1',
      userId: 'u1',
      tokenHash: 'stored-hash',
      salt: 'a'.repeat(32),
      expiresAt: new Date(Date.now() - 1000),
      revokedAt: null,
      user: { id: 'u1', email: 'a@b.com', slug: 'alice', role: 'USER' },
    } as never)

    const result = await authenticatePat(makeRequest('Bearer arche_pat_abc'))

    expect(result).toMatchObject({ ok: false, status: 401 })
  })

  it('returns user context on valid token', async () => {
    const user = { id: 'u1', email: 'a@b.com', slug: 'alice', role: 'USER' }
    mockFindByLookupHash.mockResolvedValue({
      id: 'tok-1',
      userId: 'u1',
      tokenHash: 'stored-hash',
      salt: 'a'.repeat(32),
      expiresAt: new Date(Date.now() + 86400000),
      revokedAt: null,
      user,
    } as never)

    const result = await authenticatePat(makeRequest('Bearer arche_pat_abc'))

    expect(result).toMatchObject({ ok: true, user, tokenId: 'tok-1' })
    expect(mockTouchLastUsed).toHaveBeenCalledWith('tok-1')
  })
})

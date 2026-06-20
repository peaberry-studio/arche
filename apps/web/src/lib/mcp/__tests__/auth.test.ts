import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  findByLookupHash: vi.fn(),
  touchLastUsed: vi.fn(),
}))

vi.mock('@/lib/security', () => ({ getSessionPepper: () => 'pepper' }))
vi.mock('@/lib/services', () => ({
  patService: {
    findByLookupHash: mocks.findByLookupHash,
    touchLastUsed: mocks.touchLastUsed,
  },
}))

import { authenticatePat } from '@/lib/mcp/auth'
import { hashPat, hashPatLookup } from '@/lib/mcp/pat'

const token = 'arche_pat_secret'
const salt = 'salt'

describe('authenticatePat', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.touchLastUsed.mockResolvedValue({})
  })

  it('rejects missing and unknown bearer tokens', async () => {
    await expect(authenticatePat(new Request('https://example.com/api/mcp'))).resolves.toEqual({ ok: false, status: 401 })

    mocks.findByLookupHash.mockResolvedValue(null)
    await expect(authenticatePat(createRequest(token))).resolves.toEqual({ ok: false, status: 401 })
    expect(mocks.findByLookupHash).toHaveBeenCalledWith(hashPatLookup(token))
  })

  it('enforces token expiry', async () => {
    mocks.findByLookupHash.mockResolvedValue(createRecord({ expiresAt: new Date(Date.now() - 1000) }))

    await expect(authenticatePat(createRequest(token))).resolves.toEqual({ ok: false, status: 401 })
    expect(mocks.touchLastUsed).not.toHaveBeenCalled()
  })

  it('enforces token revocation immediately', async () => {
    mocks.findByLookupHash.mockResolvedValue(createRecord({ revokedAt: new Date() }))

    await expect(authenticatePat(createRequest(token))).resolves.toEqual({ ok: false, status: 401 })
    expect(mocks.touchLastUsed).not.toHaveBeenCalled()
  })

  it('returns the token user and scopes for a valid token', async () => {
    mocks.findByLookupHash.mockResolvedValue(createRecord())

    const result = await authenticatePat(createRequest(token))

    expect(result).toEqual({
      ok: true,
      scopes: ['kb:read'],
      tokenId: 'pat-1',
      user: { id: 'u1', email: 'alice@example.com', slug: 'alice', role: 'USER', mcpAllowed: true },
    })
    expect(mocks.touchLastUsed).toHaveBeenCalledWith('pat-1')
  })
})

function createRequest(bearerToken: string): Request {
  return new Request('https://example.com/api/mcp', {
    headers: { authorization: `Bearer ${bearerToken}` },
  })
}

function createRecord(input: { expiresAt?: Date; revokedAt?: Date | null } = {}) {
  return {
    id: 'pat-1',
    scopes: ['kb:read'],
    userId: 'u1',
    tokenHash: hashPat(token, salt),
    salt,
    expiresAt: input.expiresAt ?? new Date(Date.now() + 60_000),
    revokedAt: input.revokedAt ?? null,
    user: { id: 'u1', email: 'alice@example.com', slug: 'alice', role: 'USER', mcpAllowed: true },
  }
}

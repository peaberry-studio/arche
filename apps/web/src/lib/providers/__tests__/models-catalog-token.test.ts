import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { getModelsCatalogToken, isModelsCatalogToken } from '@/lib/providers/models-catalog-token'
import { issueGatewayToken, verifyGatewayToken } from '@/lib/providers/tokens'

describe('models catalog token', () => {
  beforeEach(() => { vi.stubEnv('ARCHE_GATEWAY_TOKEN_SECRET', 'fixture') })
  afterEach(() => { vi.unstubAllEnvs(); vi.useRealTimers() })

  it('authorizes only the catalog, not provider gateway requests', () => {
    const token = getModelsCatalogToken()

    expect(isModelsCatalogToken(token)).toBe(true)
    expect(token).not.toBe(process.env.ARCHE_GATEWAY_TOKEN_SECRET)
    expect(() => verifyGatewayToken(token)).toThrow('invalid_token')
    expect(isModelsCatalogToken(issueGatewayToken({
      userId: 'user-1', workspaceSlug: 'alice', providerId: 'openai', version: 1,
    }))).toBe(false)
  })

  it.each(['', 'bad', 'x'.repeat(43)])('rejects an invalid catalog token: %s', (token) => {
    expect(isModelsCatalogToken(token)).toBe(false)
  })

  it('stays valid for catalog refreshes throughout a long-running workspace', () => {
    vi.useFakeTimers()
    const token = getModelsCatalogToken()
    vi.setSystemTime(Date.now() + 7 * 24 * 60 * 60_000)

    expect(isModelsCatalogToken(token)).toBe(true)
    expect(getModelsCatalogToken()).toBe(token)
  })

  it('invalidates old catalog URLs when the deployment signing key is rotated', () => {
    const token = getModelsCatalogToken()
    vi.stubEnv('ARCHE_GATEWAY_TOKEN_SECRET', 'rotated')

    expect(isModelsCatalogToken(token)).toBe(false)
    expect(isModelsCatalogToken(getModelsCatalogToken())).toBe(true)
  })
})

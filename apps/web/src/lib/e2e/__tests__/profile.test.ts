import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

describe('e2e profile', () => {
  const originalEnv = process.env

  beforeEach(() => {
    process.env = { ...originalEnv }
    vi.resetModules()
  })

  afterEach(() => {
    process.env = originalEnv
  })

  it('defaults to smoke-fake when ARCHE_E2E_PROFILE is not set', async () => {
    delete process.env.ARCHE_E2E_PROFILE
    const { getE2eProfile, isSmokeFakeProfile, isRealRuntimeProfile } = await import('../profile')
    expect(getE2eProfile()).toBe('smoke-fake')
    expect(isSmokeFakeProfile()).toBe(true)
    expect(isRealRuntimeProfile()).toBe(false)
  })

  it('returns real-runtime when ARCHE_E2E_PROFILE is real-runtime', async () => {
    process.env.ARCHE_E2E_PROFILE = 'real-runtime'
    const { getE2eProfile, isSmokeFakeProfile, isRealRuntimeProfile } = await import('../profile')
    expect(getE2eProfile()).toBe('real-runtime')
    expect(isSmokeFakeProfile()).toBe(false)
    expect(isRealRuntimeProfile()).toBe(true)
  })

  it('trims whitespace from ARCHE_E2E_PROFILE', async () => {
    process.env.ARCHE_E2E_PROFILE = '  real-runtime  '
    const { getE2eProfile } = await import('../profile')
    expect(getE2eProfile()).toBe('real-runtime')
  })

  it('defaults to smoke-fake for unknown values', async () => {
    process.env.ARCHE_E2E_PROFILE = 'unknown'
    const { getE2eProfile } = await import('../profile')
    expect(getE2eProfile()).toBe('smoke-fake')
  })
})

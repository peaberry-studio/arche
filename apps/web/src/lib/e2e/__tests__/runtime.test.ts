import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

describe('e2e runtime hooks', () => {
  const originalEnv = process.env

  beforeEach(() => {
    vi.resetModules()
    vi.restoreAllMocks()
    process.env = { ...originalEnv }
    delete process.env.ARCHE_ENABLE_E2E_HOOKS
    delete process.env.ARCHE_E2E_RUNTIME_BASE_URL
    delete process.env.ARCHE_E2E_RUNTIME_PASSWORD
    delete process.env.ARCHE_E2E_FAKE_PROVIDER_URL
    delete process.env.NODE_ENV
    vi.spyOn(console, 'warn').mockImplementation(() => undefined)
  })

  afterEach(() => {
    process.env = originalEnv
    vi.restoreAllMocks()
  })

  it('ignores fake runtime env without the explicit hook flag', async () => {
    process.env.ARCHE_E2E_RUNTIME_BASE_URL = 'http://127.0.0.1:4210/'
    process.env.ARCHE_E2E_RUNTIME_PASSWORD = 'fake-password'

    const runtime = await import('../runtime')

    expect(runtime.isE2eHooksEnabled()).toBe(false)
    expect(runtime.isE2eFakeRuntimeEnabled()).toBe(false)
    expect(runtime.getE2eRuntimeConnection()).toBeNull()
    expect(console.warn).not.toHaveBeenCalled()
  })

  it('enables the fake runtime only with the explicit non-production hook flag', async () => {
    process.env.ARCHE_ENABLE_E2E_HOOKS = '1'
    process.env.ARCHE_E2E_RUNTIME_BASE_URL = 'http://127.0.0.1:4210/'
    process.env.ARCHE_E2E_RUNTIME_PASSWORD = 'fake-password'

    const runtime = await import('../runtime')

    expect(runtime.isE2eHooksEnabled()).toBe(true)
    expect(runtime.isE2eFakeRuntimeEnabled()).toBe(true)
    expect(runtime.getE2eRuntimeConnection()).toEqual({
      authHeader: 'Basic b3BlbmNvZGU6ZmFrZS1wYXNzd29yZA==',
      baseUrl: 'http://127.0.0.1:4210',
      password: 'fake-password',
    })
    expect(console.warn).toHaveBeenCalledWith(
      '[e2e] fake runtime override enabled via ARCHE_E2E_RUNTIME_BASE_URL in a non-production process: http://127.0.0.1:4210',
    )
  })

  it('disables E2E hooks in production even when the flag is set', async () => {
    process.env.NODE_ENV = 'production'
    process.env.ARCHE_ENABLE_E2E_HOOKS = '1'
    process.env.ARCHE_E2E_RUNTIME_BASE_URL = 'http://127.0.0.1:4210'
    process.env.ARCHE_E2E_RUNTIME_PASSWORD = 'fake-password'
    process.env.ARCHE_E2E_FAKE_PROVIDER_URL = 'http://127.0.0.1:4211/v1'

    const runtime = await import('../runtime')

    expect(runtime.isE2eHooksEnabled()).toBe(false)
    expect(runtime.isE2eFakeRuntimeEnabled()).toBe(false)
    expect(runtime.getE2eRuntimeConnection()).toBeNull()
    expect(runtime.getE2eFakeProviderUrl()).toBeNull()
    expect(console.warn).not.toHaveBeenCalled()
  })

  it('normalizes and logs the fake provider override once', async () => {
    process.env.ARCHE_ENABLE_E2E_HOOKS = '1'
    process.env.ARCHE_E2E_FAKE_PROVIDER_URL = 'http://127.0.0.1:4211/v1/'

    const runtime = await import('../runtime')

    expect(runtime.getE2eFakeProviderUrl()).toBe('http://127.0.0.1:4211/v1')
    expect(runtime.getE2eFakeProviderUrl()).toBe('http://127.0.0.1:4211/v1')
    expect(console.warn).toHaveBeenCalledTimes(1)
    expect(console.warn).toHaveBeenCalledWith(
      '[e2e] fake provider override enabled via ARCHE_E2E_FAKE_PROVIDER_URL in a non-production process: http://127.0.0.1:4211/v1',
    )
  })
})

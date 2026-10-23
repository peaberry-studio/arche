import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({ lookup: vi.fn(), connect: vi.fn() }))
vi.mock('node:dns/promises', () => ({ lookup: mocks.lookup }))
vi.mock('undici', () => ({
  Agent: class {
    constructor(options: { connect: { lookup: unknown } }) { mocks.connect(options.connect.lookup) }
  },
}))

import { publicFetch } from '@/lib/security/public-fetch'

describe('publicFetch', () => {
  beforeEach(() => {
    mocks.lookup.mockReset().mockResolvedValue([{ address: '8.8.8.8', family: 4 }])
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('ok')))
  })
  afterEach(() => { vi.unstubAllGlobals(); vi.unstubAllEnvs() })

  it.each(['https://127.0.0.1/', 'https://[::127.0.0.1]/', 'https://[::ffff:0:127.0.0.1]/', 'https://[::ffff:7f00:1]/', 'https://[0:0:0:0:0:ffff:7f00:1]/', 'https://169.254.169.254/', 'http://8.8.8.8/', 'https://user:password@example.com/'])('rejects %s before sending credentials', async (url) => {
    await expect(publicFetch(url)).rejects.toThrow()
    expect(fetch).not.toHaveBeenCalled()
  })

  it('permits only the opted-in development OAuth fixture', async () => {
    vi.stubEnv('NODE_ENV', 'development')
    vi.stubEnv('ARCHE_ENABLE_E2E_HOOKS', '1')
    await publicFetch('http://127.0.0.1:4212/token')
    expect(fetch).toHaveBeenCalledWith('http://127.0.0.1:4212/token', { redirect: 'error' })
    await expect(publicFetch('http://127.0.0.1:4213/token')).rejects.toThrow()
  })

  it('rejects the OAuth fixture in production even with E2E hooks set', async () => {
    vi.stubEnv('NODE_ENV', 'production')
    vi.stubEnv('ARCHE_ENABLE_E2E_HOOKS', '1')
    await expect(publicFetch('http://127.0.0.1:4212/token')).rejects.toThrow()
    expect(fetch).not.toHaveBeenCalled()
  })

  it('disables redirects even when the caller asks to follow them', async () => {
    await publicFetch('https://example.com/', { redirect: 'follow' })
    expect(fetch).toHaveBeenCalledWith('https://example.com/', expect.objectContaining({ redirect: 'error', dispatcher: expect.anything() }))
  })

  it('rejects DNS rebinding at connection time', async () => {
    await publicFetch('https://example.com/')
    mocks.lookup.mockResolvedValue([{ address: '10.0.0.1', family: 4 }])
    const lookup = mocks.connect.mock.calls[0][0]
    const callback = vi.fn()
    lookup('example.com', { all: true }, callback)
    await vi.waitFor(() => expect(callback).toHaveBeenCalledWith(expect.any(Error), [], 0))
  })

  it('returns only checked public addresses to the socket', async () => {
    const lookup = mocks.connect.mock.calls[0][0]
    const callback = vi.fn()
    lookup('example.com', { all: true }, callback)
    await vi.waitFor(() => expect(callback).toHaveBeenCalledWith(null, [{ address: '8.8.8.8', family: 4 }]))
  })
})

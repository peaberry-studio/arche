import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import {
  getInstanceBasicAuth,
  getInstanceUrl,
  resolveInstanceConnection,
} from '@/lib/opencode/connection-resolver'

const getE2eRuntimeConnectionMock = vi.hoisted(() => vi.fn())
const isE2eFakeRuntimeEnabledMock = vi.hoisted(() => vi.fn())
const getRuntimeCapabilitiesMock = vi.hoisted(() => vi.fn())
const findCredentialsBySlugMock = vi.hoisted(() => vi.fn())
const decryptPasswordMock = vi.hoisted(() => vi.fn())

vi.mock('@/lib/e2e/runtime', () => ({
  getE2eRuntimeConnection: (...args: unknown[]) => getE2eRuntimeConnectionMock(...args),
  isE2eFakeRuntimeEnabled: () => isE2eFakeRuntimeEnabledMock(),
}))

vi.mock('@/lib/runtime/capabilities', () => ({
  getRuntimeCapabilities: () => getRuntimeCapabilitiesMock(),
}))

vi.mock('@/lib/services', () => ({
  instanceService: {
    findCredentialsBySlug: (...args: unknown[]) => findCredentialsBySlugMock(...args),
  },
}))

vi.mock('@/lib/spawner/crypto', () => ({
  decryptPassword: (...args: unknown[]) => decryptPasswordMock(...args),
}))

const originalDesktopPort = process.env.ARCHE_DESKTOP_OPENCODE_PORT

describe('connection-resolver', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    delete process.env.ARCHE_DESKTOP_OPENCODE_PORT
    isE2eFakeRuntimeEnabledMock.mockReturnValue(false)
    getRuntimeCapabilitiesMock.mockReturnValue({ containers: true })
    findCredentialsBySlugMock.mockResolvedValue({
      serverPassword: 'encrypted-password',
      status: 'running',
    })
    decryptPasswordMock.mockReturnValue('plain-password')
  })

  afterEach(() => {
    if (originalDesktopPort === undefined) {
      delete process.env.ARCHE_DESKTOP_OPENCODE_PORT
    } else {
      process.env.ARCHE_DESKTOP_OPENCODE_PORT = originalDesktopPort
    }
  })

  it('resolves real container and desktop base URLs', () => {
    expect(getInstanceUrl('alice')).toBe('http://opencode-alice:4096')
    expect(getInstanceUrl('alice', 'http://override:4096')).toBe('http://override:4096')

    getRuntimeCapabilitiesMock.mockReturnValue({ containers: false })
    process.env.ARCHE_DESKTOP_OPENCODE_PORT = '5090'
    expect(getInstanceUrl('alice')).toBe('http://127.0.0.1:5090')

    process.env.ARCHE_DESKTOP_OPENCODE_PORT = 'invalid'
    expect(getInstanceUrl('alice')).toBe('http://127.0.0.1:4096')
  })

  it('resolves real credentials and basic auth', async () => {
    const connection = await resolveInstanceConnection('alice')

    expect(findCredentialsBySlugMock).toHaveBeenCalledWith('alice')
    expect(decryptPasswordMock).toHaveBeenCalledWith('encrypted-password')
    expect(connection).toEqual({
      authHeader: `Basic ${Buffer.from('opencode:plain-password').toString('base64')}`,
      baseUrl: 'http://opencode-alice:4096',
      password: 'plain-password',
      username: 'opencode',
    })
    await expect(getInstanceBasicAuth('alice')).resolves.toEqual({
      authHeader: `Basic ${Buffer.from('opencode:plain-password').toString('base64')}`,
      baseUrl: 'http://opencode-alice:4096',
    })
  })

  it('returns null when credentials are unavailable or cannot be decrypted', async () => {
    findCredentialsBySlugMock.mockResolvedValueOnce(null)
    await expect(resolveInstanceConnection('missing')).resolves.toBeNull()

    findCredentialsBySlugMock.mockResolvedValueOnce({ status: 'stopped', serverPassword: 'encrypted-password' })
    await expect(resolveInstanceConnection('stopped')).resolves.toBeNull()

    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
    decryptPasswordMock.mockImplementationOnce(() => {
      throw new Error('decrypt failed')
    })

    await expect(resolveInstanceConnection('alice')).resolves.toBeNull()
    expect(errorSpy).toHaveBeenCalledWith('[opencode/client] Failed to decrypt password for alice')
    errorSpy.mockRestore()
  })

  it('uses E2E runtime connection when fake runtime is enabled', async () => {
    isE2eFakeRuntimeEnabledMock.mockReturnValue(true)
    getE2eRuntimeConnectionMock.mockReturnValue({
      baseUrl: 'http://127.0.0.1:7777',
      password: 'fake-password',
    })

    expect(getInstanceUrl('alice')).toBe('http://127.0.0.1:7777')
    const connection = await resolveInstanceConnection('alice')
    expect(connection).toMatchObject({
      baseUrl: 'http://127.0.0.1:7777',
      password: 'fake-password',
      username: 'opencode',
    })
    expect(decryptPasswordMock).not.toHaveBeenCalled()
  })

  it('falls back to real URL when E2E base URL is unavailable', async () => {
    isE2eFakeRuntimeEnabledMock.mockReturnValue(true)
    getE2eRuntimeConnectionMock.mockReturnValue(null)

    expect(getInstanceUrl('alice')).toBe('http://opencode-alice:4096')
    await expect(resolveInstanceConnection('alice')).resolves.toBeNull()
  })
})

import { describe, it, expect, vi, beforeEach } from 'vitest'

const replaceCredentialMock = vi.fn()
const findActiveCredentialMock = vi.fn()
vi.mock('@/lib/services', () => ({
  providerService: {
    replaceCredential: (...args: unknown[]) => replaceCredentialMock(...args),
    findActiveCredential: (...args: unknown[]) => findActiveCredentialMock(...args),
  },
}))

vi.mock('@/lib/providers/crypto', () => ({
  encryptProviderSecret: vi.fn(() => 'encrypted-secret'),
}))

import { encryptProviderSecret } from '@/lib/providers/crypto'
import { getActiveCredentialForUser, replaceApiCredential } from '@/lib/providers/store'

const mockEncrypt = vi.mocked(encryptProviderSecret)

beforeEach(() => {
  vi.clearAllMocks()
})

describe('providers/store', () => {
  it('replaces api credential with encrypted secret', async () => {
    replaceCredentialMock.mockResolvedValue({
      id: 'cred-1',
      type: 'api',
      secret: 'encrypted-secret',
      version: 2,
    })

    const result = await replaceApiCredential({
      userId: 'user-1',
      providerId: 'openai',
      apiKey: 'sk-123',
    })

    expect(mockEncrypt).toHaveBeenCalledWith({ apiKey: 'sk-123' })
    expect(replaceCredentialMock).toHaveBeenCalledWith({
        userId: 'user-1',
        providerId: 'openai',
        type: 'api',
        secret: 'encrypted-secret',
    })
    expect(result).toEqual({
      id: 'cred-1',
      type: 'api',
      secret: 'encrypted-secret',
      version: 2,
    })
  })

  it('returns active credential for user and provider', async () => {
    findActiveCredentialMock.mockResolvedValue({
      id: 'cred-2',
      type: 'api',
      secret: 'encrypted-secret',
      version: 3,
    })

    const result = await getActiveCredentialForUser({
      userId: 'user-1',
      providerId: 'openai',
    })

    expect(findActiveCredentialMock).toHaveBeenCalledWith('user-1', 'openai')
    expect(result).toEqual({
      id: 'cred-2',
      type: 'api',
      secret: 'encrypted-secret',
      version: 3,
    })
  })
})

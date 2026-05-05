import { beforeEach, describe, expect, it, vi } from 'vitest'

const mockReplaceCredential = vi.hoisted(() => vi.fn())
const mockFindActiveCredential = vi.hoisted(() => vi.fn())
const mockEncryptProviderSecret = vi.hoisted(() => vi.fn())

vi.mock('@/lib/services', () => ({
  providerService: {
    replaceCredential: (...args: unknown[]) => mockReplaceCredential(...args),
    findActiveCredential: (...args: unknown[]) => mockFindActiveCredential(...args),
  },
}))

vi.mock('@/lib/providers/crypto', () => ({
  encryptProviderSecret: (...args: unknown[]) => mockEncryptProviderSecret(...args),
}))

import { replaceApiCredential, getActiveCredentialForUser } from '../store'

describe('store', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  describe('replaceApiCredential', () => {
    it('encrypts the api key and calls providerService.replaceCredential', async () => {
      mockEncryptProviderSecret.mockReturnValue('encrypted-secret')
      mockReplaceCredential.mockResolvedValue({
        id: 'cred-1',
        type: 'api',
        secret: 'encrypted-secret',
        version: 2,
      })

      const result = await replaceApiCredential({
        userId: 'u1',
        providerId: 'openai',
        apiKey: 'sk-test-key',
      })

      expect(mockEncryptProviderSecret).toHaveBeenCalledWith({ apiKey: 'sk-test-key' })
      expect(mockReplaceCredential).toHaveBeenCalledWith({
        userId: 'u1',
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
  })

  describe('getActiveCredentialForUser', () => {
    it('returns active credential from providerService', async () => {
      mockFindActiveCredential.mockResolvedValue({
        id: 'cred-1',
        type: 'api',
        secret: 'encrypted-secret',
        version: 1,
      })

      const result = await getActiveCredentialForUser({
        userId: 'u1',
        providerId: 'openai',
      })

      expect(mockFindActiveCredential).toHaveBeenCalledWith('u1', 'openai')
      expect(result).toEqual({
        id: 'cred-1',
        type: 'api',
        secret: 'encrypted-secret',
        version: 1,
      })
    })

    it('returns null when no active credential exists', async () => {
      mockFindActiveCredential.mockResolvedValue(null)

      const result = await getActiveCredentialForUser({
        userId: 'u1',
        providerId: 'openai',
      })

      expect(result).toBeNull()
    })
  })
})

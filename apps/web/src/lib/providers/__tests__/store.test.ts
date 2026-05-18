import { beforeEach, describe, expect, it, vi } from 'vitest'

const mockReplaceCredential = vi.hoisted(() => vi.fn())
const mockReplaceOrganizationCredential = vi.hoisted(() => vi.fn())
const mockFindActiveCredential = vi.hoisted(() => vi.fn())
const mockGetEffectiveCredentialForUser = vi.hoisted(() => vi.fn())
const mockEncryptProviderSecret = vi.hoisted(() => vi.fn())

vi.mock('@/lib/services', () => ({
  providerService: {
    replaceCredential: (...args: unknown[]) => mockReplaceCredential(...args),
    replaceOrganizationCredential: (...args: unknown[]) => mockReplaceOrganizationCredential(...args),
    findActiveCredential: (...args: unknown[]) => mockFindActiveCredential(...args),
    getEffectiveCredentialForUser: (...args: unknown[]) => mockGetEffectiveCredentialForUser(...args),
  },
}))

vi.mock('@/lib/providers/crypto', () => ({
  encryptProviderSecret: (...args: unknown[]) => mockEncryptProviderSecret(...args),
}))

import {
  getActiveCredentialForUser,
  getEffectiveCredentialForUser,
  replaceApiCredential,
  replaceOrganizationApiCredential,
} from '../store'

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

  describe('replaceOrganizationApiCredential', () => {
    it('encrypts the api key and calls providerService.replaceOrganizationCredential', async () => {
      mockEncryptProviderSecret.mockReturnValue('encrypted-secret')
      mockReplaceOrganizationCredential.mockResolvedValue({
        id: 'org-cred-1',
        type: 'api',
        secret: 'encrypted-secret',
        version: 4,
      })

      const result = await replaceOrganizationApiCredential({
        providerId: 'openai',
        apiKey: 'sk-org-key',
      })

      expect(mockEncryptProviderSecret).toHaveBeenCalledWith({ apiKey: 'sk-org-key' })
      expect(mockReplaceOrganizationCredential).toHaveBeenCalledWith({
        providerId: 'openai',
        type: 'api',
        secret: 'encrypted-secret',
      })
      expect(result).toEqual({
        id: 'org-cred-1',
        type: 'api',
        secret: 'encrypted-secret',
        version: 4,
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

  describe('getEffectiveCredentialForUser', () => {
    it('returns effective credential from providerService', async () => {
      mockGetEffectiveCredentialForUser.mockResolvedValue({
        source: 'organization',
        credential: {
          id: 'org-cred-1',
          type: 'api',
          secret: 'encrypted-secret',
          version: 3,
        },
      })

      const result = await getEffectiveCredentialForUser({
        userId: 'u1',
        providerId: 'openai',
      })

      expect(mockGetEffectiveCredentialForUser).toHaveBeenCalledWith({ userId: 'u1', providerId: 'openai' })
      expect(result).toEqual({
        source: 'organization',
        credential: {
          id: 'org-cred-1',
          type: 'api',
          secret: 'encrypted-secret',
          version: 3,
        },
      })
    })
  })
})

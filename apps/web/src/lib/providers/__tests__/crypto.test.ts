import { beforeEach, describe, expect, it, vi } from 'vitest'

const mockEncryptPassword = vi.hoisted(() => vi.fn())
const mockDecryptPassword = vi.hoisted(() => vi.fn())

vi.mock('@/lib/spawner/crypto', () => ({
  encryptPassword: (...args: unknown[]) => mockEncryptPassword(...args),
  decryptPassword: (...args: unknown[]) => mockDecryptPassword(...args),
}))

import { encryptProviderSecret, decryptProviderSecret } from '../crypto'

describe('provider crypto', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  describe('encryptProviderSecret', () => {
    it('encrypts a valid secret', () => {
      mockEncryptPassword.mockReturnValue('encrypted-value')
      const secret = { apiKey: 'sk-test' }

      const result = encryptProviderSecret(secret)

      expect(mockEncryptPassword).toHaveBeenCalledWith(JSON.stringify(secret))
      expect(result).toBe('encrypted-value')
    })

    it('throws when secret exceeds max size', () => {
      const hugeKey = 'x'.repeat(17 * 1024)
      const secret = { apiKey: hugeKey }

      expect(() => encryptProviderSecret(secret)).toThrow('Provider secret exceeds maximum size')
      expect(mockEncryptPassword).not.toHaveBeenCalled()
    })

    it('accepts a secret at exactly max size boundary', () => {
      // Create a secret that when JSON stringified is exactly 16*1024 chars
      const base = '{"apiKey":""}'
      const keySize = 16 * 1024 - base.length
      const secret = { apiKey: 'k'.repeat(keySize) }
      // Verify size before mocking
      expect(JSON.stringify(secret).length).toBe(16 * 1024)

      mockEncryptPassword.mockReturnValue('encrypted-value')
      expect(() => encryptProviderSecret(secret)).not.toThrow()
    })
  })

  describe('decryptProviderSecret', () => {
    it('decrypts and parses a valid encrypted secret', () => {
      const original = { apiKey: 'sk-test' }
      mockDecryptPassword.mockReturnValue(JSON.stringify(original))

      const result = decryptProviderSecret('encrypted-value')

      expect(mockDecryptPassword).toHaveBeenCalledWith('encrypted-value')
      expect(result).toEqual(original)
    })

    it('throws when decryption fails', () => {
      mockDecryptPassword.mockImplementation(() => {
        throw new Error('bad key')
      })

      expect(() => decryptProviderSecret('bad-data')).toThrow('Failed to decrypt provider secret')
    })

    it('throws when decrypted data is not valid JSON', () => {
      mockDecryptPassword.mockReturnValue('not-json')

      expect(() => decryptProviderSecret('encrypted-value')).toThrow('Failed to decrypt provider secret')
    })
  })
})

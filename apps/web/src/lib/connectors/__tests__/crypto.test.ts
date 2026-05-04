import { beforeEach, describe, expect, it, vi } from 'vitest'

const mockEncryptPassword = vi.fn()
const mockDecryptPassword = vi.fn()

vi.mock('@/lib/spawner/crypto', () => ({
  encryptPassword: (value: string) => mockEncryptPassword(value),
  decryptPassword: (value: string) => mockDecryptPassword(value),
}))

describe('connectors/crypto', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  describe('encryptConfig', () => {
    it('encrypts a config object', async () => {
      mockEncryptPassword.mockReturnValue('encrypted-string')
      const { encryptConfig } = await import('@/lib/connectors/crypto')
      const result = encryptConfig({ apiKey: 'secret' })
      expect(result).toBe('encrypted-string')
      expect(mockEncryptPassword).toHaveBeenCalledWith('{"apiKey":"secret"}')
    })

    it('throws when config exceeds max size', async () => {
      const { encryptConfig } = await import('@/lib/connectors/crypto')
      const largeConfig: Record<string, unknown> = {}
      const largeValue = 'x'.repeat(11 * 1024)
      largeConfig.key = largeValue
      expect(() => encryptConfig(largeConfig)).toThrow('Connector configuration exceeds maximum size')
    })
  })

  describe('decryptConfig', () => {
    it('decrypts a config string', async () => {
      mockDecryptPassword.mockReturnValue('{"apiKey":"secret"}')
      const { decryptConfig } = await import('@/lib/connectors/crypto')
      const result = decryptConfig('encrypted-string')
      expect(result).toEqual({ apiKey: 'secret' })
    })

    it('throws when decryption fails', async () => {
      mockDecryptPassword.mockReturnValue('not-json')
      const { decryptConfig } = await import('@/lib/connectors/crypto')
      expect(() => decryptConfig('bad-string')).toThrow('Failed to decrypt connector configuration')
    })

    it('throws when decryptPassword throws', async () => {
      mockDecryptPassword.mockImplementation(() => {
        throw new Error('decryption error')
      })
      const { decryptConfig } = await import('@/lib/connectors/crypto')
      expect(() => decryptConfig('bad-string')).toThrow('Failed to decrypt connector configuration')
    })
  })
})

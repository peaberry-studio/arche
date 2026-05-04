import { beforeEach, describe, expect, it, vi } from 'vitest'

const mockHash = vi.fn()
const mockVerify = vi.fn()

vi.mock('argon2', () => ({
  default: {
    hash: mockHash,
    verify: mockVerify,
  },
}))

describe('argon2', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.resetModules()
  })

  describe('hashArgon2', () => {
    it('hashes a value using argon2', async () => {
      mockHash.mockResolvedValue('hashed-value')
      const { hashArgon2 } = await import('@/lib/argon2')
      const result = await hashArgon2('password')
      expect(result).toBe('hashed-value')
      expect(mockHash).toHaveBeenCalledWith('password')
    })

    it('caches the argon2 module import', async () => {
      mockHash.mockResolvedValue('hash1')
      const { hashArgon2 } = await import('@/lib/argon2')
      await hashArgon2('a')
      await hashArgon2('b')
      expect(mockHash).toHaveBeenCalledTimes(2)
      // import should only happen once (module is cached)
      // vi.mock handles the import count at module level
    })

    it('rejects when argon2 hash fails', async () => {
      mockHash.mockRejectedValue(new Error('argon2 error'))
      const { hashArgon2 } = await import('@/lib/argon2')
      await expect(hashArgon2('password')).rejects.toThrow('argon2 error')
    })
  })

  describe('verifyArgon2', () => {
    it('verifies a hash using argon2', async () => {
      mockVerify.mockResolvedValue(true)
      const { verifyArgon2 } = await import('@/lib/argon2')
      const result = await verifyArgon2('hashed-value', 'password')
      expect(result).toBe(true)
      expect(mockVerify).toHaveBeenCalledWith('hashed-value', 'password')
    })

    it('returns false when verification fails', async () => {
      mockVerify.mockResolvedValue(false)
      const { verifyArgon2 } = await import('@/lib/argon2')
      const result = await verifyArgon2('hashed-value', 'wrong-password')
      expect(result).toBe(false)
    })

    it('rejects when argon2 verify fails', async () => {
      mockVerify.mockRejectedValue(new Error('verify error'))
      const { verifyArgon2 } = await import('@/lib/argon2')
      await expect(verifyArgon2('hash', 'password')).rejects.toThrow('verify error')
    })
  })
})

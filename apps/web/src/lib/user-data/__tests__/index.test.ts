import { beforeEach, describe, expect, it, vi } from 'vitest'

const mockMkdir = vi.fn()
const mockGetUserDataPath = vi.fn()
const mockAssertValidSlug = vi.fn()

vi.mock('fs/promises', () => ({
  mkdir: (...args: unknown[]) => mockMkdir(...args),
}))

vi.mock('@/lib/runtime/paths', () => ({
  getUserDataPath: (slug: string) => mockGetUserDataPath(slug),
}))

vi.mock('@/lib/validation/slug', () => ({
  assertValidSlug: (slug: string) => mockAssertValidSlug(slug),
}))

describe('user-data', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockGetUserDataPath.mockReturnValue('/data/users/alice')
  })

  describe('ensureUserDirectory', () => {
    it('creates the user directory recursively with restricted permissions', async () => {
      mockMkdir.mockResolvedValue(undefined)
      mockAssertValidSlug.mockImplementation(() => {})

      const { ensureUserDirectory } = await import('../index')
      const result = await ensureUserDirectory('alice')

      expect(result).toBe('/data/users/alice')
      expect(mockAssertValidSlug).toHaveBeenCalledWith('alice')
      expect(mockMkdir).toHaveBeenCalledWith('/data/users/alice', { recursive: true, mode: 0o700 })
    })

    it('propagates validation errors for invalid slugs', async () => {
      mockAssertValidSlug.mockImplementation(() => { throw new Error('invalid slug') })

      const { ensureUserDirectory } = await import('../index')
      await expect(ensureUserDirectory('bad slug')).rejects.toThrow('invalid slug')
      expect(mockMkdir).not.toHaveBeenCalled()
    })
  })

  describe('getUserDataHostPath', () => {
    it('returns the user data path for a valid slug', async () => {
      mockAssertValidSlug.mockImplementation(() => {})

      const { getUserDataHostPath } = await import('../index')
      const result = getUserDataHostPath('alice')

      expect(result).toBe('/data/users/alice')
      expect(mockAssertValidSlug).toHaveBeenCalledWith('alice')
    })

    it('propagates validation errors for invalid slugs', async () => {
      mockAssertValidSlug.mockImplementation(() => { throw new Error('invalid slug') })

      const { getUserDataHostPath } = await import('../index')
      expect(() => getUserDataHostPath('bad slug')).toThrow('invalid slug')
    })
  })
})

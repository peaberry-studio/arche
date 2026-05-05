import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@/lib/workspace-paths', () => ({
  normalizeWorkspacePath: (path: string) => {
    const trimmed = path.trim().replace(/^\/+/, '')
    return trimmed || ''
  },
}))

import { downloadWorkspaceFile, getWorkspaceFileDownloadUrl } from '../workspace-file-download'

describe('workspace-file-download', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  describe('getWorkspaceFileDownloadUrl', () => {
    it('returns a download url for a normalized path', () => {
      const url = getWorkspaceFileDownloadUrl('alice', 'docs/readme.md')
      expect(url).toBe('/api/w/alice/files/download?path=docs%2Freadme.md')
    })

    it('returns null when the path normalizes to empty', () => {
      const url = getWorkspaceFileDownloadUrl('alice', '  ')
      expect(url).toBeNull()
    })

    it('encodes the slug in the path', () => {
      const url = getWorkspaceFileDownloadUrl('alice-ws', 'file.txt')
      expect(url).toBe('/api/w/alice-ws/files/download?path=file.txt')
    })
  })

  describe('downloadWorkspaceFile', () => {
    it('returns false when document is unavailable (node environment)', () => {
      const result = downloadWorkspaceFile('alice', 'docs/readme.md')
      expect(result).toBe(false)
    })

    it('returns false when the url is null', () => {
      const result = downloadWorkspaceFile('alice', '  ')
      expect(result).toBe(false)
    })
  })
})

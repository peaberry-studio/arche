import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@/lib/git/bare-repo', () => ({
  runGitOnBareRepo: vi.fn(),
}))

vi.mock('@/lib/runtime/paths', () => ({
  getKbContentRoot: vi.fn(() => '/kb-content'),
}))

import { runGitOnBareRepo } from '@/lib/git/bare-repo'
import { readKbArticle } from '../read-kb-article'

const mockRunGit = vi.mocked(runGitOnBareRepo)

describe('readKbArticle', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('reads a markdown file successfully', async () => {
    mockRunGit.mockResolvedValue({ ok: true, stdout: '# Hello\n\nWorld\n' })

    const result = await readKbArticle({ path: 'docs/intro.md' })

    expect(mockRunGit).toHaveBeenCalledWith('/kb-content', ['show', 'HEAD:docs/intro.md'])
    expect(result).toEqual({
      ok: true,
      kind: 'text',
      content: '# Hello\n\nWorld\n',
      truncated: false,
    })
  })

  it('rejects path traversal attempts', async () => {
    const result = await readKbArticle({ path: '../../etc/passwd' })

    expect(mockRunGit).not.toHaveBeenCalled()
    expect(result).toMatchObject({ ok: false, error: 'invalid_path' })
  })

  it('returns binary metadata for unsupported file extensions', async () => {
    mockRunGit.mockResolvedValue({ ok: true, stdout: '1234\n' })

    const result = await readKbArticle({ path: 'images/logo.png' })

    expect(mockRunGit).toHaveBeenCalledWith('/kb-content', ['cat-file', '-s', 'HEAD:images/logo.png'])
    expect(result).toEqual({
      ok: true,
      kind: 'binary',
      metadata: {
        name: 'logo.png',
        path: 'images/logo.png',
        size: 1234,
      },
    })
  })

  it('truncates content beyond maxLines', async () => {
    const longContent = Array.from({ length: 600 }, (_, index) => `Line ${index + 1}`).join('\n')
    mockRunGit.mockResolvedValue({ ok: true, stdout: longContent })

    const result = await readKbArticle({ path: 'docs/long.md', maxLines: 500 })

    expect(result).toMatchObject({ ok: true, kind: 'text', truncated: true })
    if (result.ok && result.kind === 'text') {
      const lines = result.content.split('\n')
      expect(lines[lines.length - 1]).toContain('[truncated')
    }
  })

  it('returns error when file is not found', async () => {
    mockRunGit.mockResolvedValue({ ok: false, stderr: 'fatal: path does not exist' })

    const result = await readKbArticle({ path: 'missing.md' })

    expect(result).toMatchObject({ ok: false, error: 'not_found' })
  })

  it('accepts .yaml, .yml, .json, and .txt extensions', async () => {
    mockRunGit.mockResolvedValue({ ok: true, stdout: '{}' })

    for (const extension of ['.yaml', '.yml', '.json', '.txt']) {
      const result = await readKbArticle({ path: `file${extension}` })
      expect(result).toMatchObject({ ok: true, kind: 'text' })
    }
  })
})

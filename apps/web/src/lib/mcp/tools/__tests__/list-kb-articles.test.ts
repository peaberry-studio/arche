import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@/lib/git/bare-repo', () => ({
  runGitOnBareRepo: vi.fn(),
}))

vi.mock('@/lib/runtime/paths', () => ({
  getKbContentRoot: vi.fn(() => '/kb-content'),
}))

import { runGitOnBareRepo } from '@/lib/git/bare-repo'
import { listKbArticles } from '../list-kb-articles'

const mockRunGit = vi.mocked(runGitOnBareRepo)

describe('listKbArticles', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('lists all files when no path is given', async () => {
    mockRunGit.mockResolvedValue({
      ok: true,
      stdout: 'docs/intro.md\ndocs/faq.md\nREADME.md\n',
    })

    const result = await listKbArticles({})

    expect(mockRunGit).toHaveBeenCalledWith('/kb-content', [
      'ls-tree',
      '-r',
      '--name-only',
      'HEAD',
    ])
    expect(result).toEqual({
      ok: true,
      entries: [
        {
          name: 'README.md',
          path: 'README.md',
          type: 'file',
        },
        {
          name: 'docs',
          path: 'docs',
          type: 'directory',
          children: [
            {
              name: 'faq.md',
              path: 'docs/faq.md',
              type: 'file',
            },
            {
              name: 'intro.md',
              path: 'docs/intro.md',
              type: 'file',
            },
          ],
        },
      ],
    })
  })

  it('lists files in a subdirectory when path is given', async () => {
    mockRunGit.mockResolvedValue({
      ok: true,
      stdout: 'docs/intro.md\ndocs/faq.md\n',
    })

    const result = await listKbArticles({ path: 'docs/' })

    expect(mockRunGit).toHaveBeenCalledWith('/kb-content', [
      'ls-tree',
      '-r',
      '--name-only',
      'HEAD',
      'docs',
    ])
    expect(result).toEqual({
      ok: true,
      entries: [
        {
          name: 'faq.md',
          path: 'docs/faq.md',
          type: 'file',
        },
        {
          name: 'intro.md',
          path: 'docs/intro.md',
          type: 'file',
        },
      ],
    })
  })

  it('rejects path traversal attempts', async () => {
    const result = await listKbArticles({ path: '../../../etc' })

    expect(mockRunGit).not.toHaveBeenCalled()
    expect(result).toEqual({
      ok: false,
      error: 'invalid_path',
    })
  })

  it('returns error when bare repo is not available', async () => {
    mockRunGit.mockResolvedValue({ ok: false, stderr: 'not_bare_repository' })

    const result = await listKbArticles({})

    expect(result).toEqual({
      ok: false,
      error: 'kb_unavailable',
    })
  })

  it('returns an empty array when the vault is empty', async () => {
    mockRunGit.mockResolvedValue({ ok: true, stdout: '' })

    const result = await listKbArticles({})

    expect(result).toEqual({ ok: true, entries: [] })
  })
})

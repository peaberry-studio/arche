import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@/lib/git/bare-repo', () => ({
  runGitOnBareRepo: vi.fn(),
}))

vi.mock('@/lib/runtime/paths', () => ({
  getKbContentRoot: vi.fn(() => '/kb-content'),
}))

import { runGitOnBareRepo } from '@/lib/git/bare-repo'
import { searchKb } from '../search-kb'

const mockRunGit = vi.mocked(runGitOnBareRepo)

describe('searchKb', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('searches across the entire vault', async () => {
    mockRunGit.mockResolvedValue({
      ok: true,
      stdout: 'HEAD:docs/pricing.md:5:Our pricing starts at $10/month\n',
    })

    const result = await searchKb({ query: 'pricing' })

    expect(mockRunGit).toHaveBeenCalledWith('/kb-content', [
      'grep',
      '-n',
      '-I',
      '-F',
      '-C',
      '3',
      '--max-count',
      '20',
      '-e',
      'pricing',
      'HEAD',
    ])
    expect(result).toEqual({
      ok: true,
      matches: [
        {
          file: 'docs/pricing.md',
          line: 5,
          snippet: 'HEAD:docs/pricing.md:5:Our pricing starts at $10/month',
        },
      ],
    })
  })

  it('scopes search to a path when provided', async () => {
    mockRunGit.mockResolvedValue({ ok: true, stdout: '' })

    await searchKb({ query: 'test', path: 'docs/' })

    expect(mockRunGit).toHaveBeenCalledWith('/kb-content', [
      'grep',
      '-n',
      '-I',
      '-F',
      '-C',
      '3',
      '--max-count',
      '20',
      '-e',
      'test',
      'HEAD',
      '--',
      'docs',
    ])
  })

  it('supports case-insensitive search', async () => {
    mockRunGit.mockResolvedValue({ ok: true, stdout: '' })

    await searchKb({ query: 'Pricing', caseSensitive: false })

    expect(mockRunGit).toHaveBeenCalledWith('/kb-content', [
      'grep',
      '-n',
      '-I',
      '-F',
      '-C',
      '3',
      '--max-count',
      '20',
      '-i',
      '-e',
      'Pricing',
      'HEAD',
    ])
  })

  it('rejects path traversal in the path param', async () => {
    const result = await searchKb({ query: 'test', path: '../../etc' })

    expect(mockRunGit).not.toHaveBeenCalled()
    expect(result).toMatchObject({ ok: false, error: 'invalid_path' })
  })

  it('rejects an empty query', async () => {
    const result = await searchKb({ query: '' })

    expect(mockRunGit).not.toHaveBeenCalled()
    expect(result).toMatchObject({ ok: false, error: 'empty_query' })
  })

  it('returns empty matches when nothing is found', async () => {
    mockRunGit.mockResolvedValue({ ok: false, stderr: '' })

    const result = await searchKb({ query: 'nonexistent' })

    expect(result).toEqual({ ok: true, matches: [] })
  })

  it('caps the limit at 100', async () => {
    mockRunGit.mockResolvedValue({ ok: true, stdout: '' })

    await searchKb({ query: 'test', limit: 999 })

    expect(mockRunGit).toHaveBeenCalledWith('/kb-content', [
      'grep',
      '-n',
      '-I',
      '-F',
      '-C',
      '3',
      '--max-count',
      '100',
      '-e',
      'test',
      'HEAD',
    ])
  })

  it('treats a leading dash query as literal text instead of a git grep option', async () => {
    mockRunGit.mockResolvedValue({ ok: true, stdout: '' })

    await searchKb({ query: '--help' })

    expect(mockRunGit).toHaveBeenCalledWith('/kb-content', [
      'grep',
      '-n',
      '-I',
      '-F',
      '-C',
      '3',
      '--max-count',
      '20',
      '-e',
      '--help',
      'HEAD',
    ])
  })

  it('returns every match line from a grouped git grep block', async () => {
    mockRunGit.mockResolvedValue({
      ok: true,
      stdout: [
        'HEAD:docs/pricing.md:5:Pricing starts at $10',
        'HEAD:docs/pricing.md:7:Pricing includes support',
      ].join('\n'),
    })

    const result = await searchKb({ query: 'Pricing' })

    expect(result).toEqual({
      ok: true,
      matches: [
        {
          file: 'docs/pricing.md',
          line: 5,
          snippet: [
            'HEAD:docs/pricing.md:5:Pricing starts at $10',
            'HEAD:docs/pricing.md:7:Pricing includes support',
          ].join('\n'),
        },
        {
          file: 'docs/pricing.md',
          line: 7,
          snippet: [
            'HEAD:docs/pricing.md:5:Pricing starts at $10',
            'HEAD:docs/pricing.md:7:Pricing includes support',
          ].join('\n'),
        },
      ],
    })
  })
})

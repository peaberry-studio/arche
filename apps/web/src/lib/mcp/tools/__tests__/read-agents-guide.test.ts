import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@/lib/config-repo-store', () => ({
  readConfigRepoFileBuffer: vi.fn(),
}))

import { readConfigRepoFileBuffer } from '@/lib/config-repo-store'
import { readAgentsGuide } from '../read-agents-guide'

const mockReadConfigRepoFileBuffer = vi.mocked(readConfigRepoFileBuffer)

describe('readAgentsGuide', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('returns the raw guide when no user context is provided', async () => {
    mockReadConfigRepoFileBuffer.mockResolvedValue({
      ok: true,
      content: Buffer.from('# Base guide\n'),
      hash: 'hash-1',
    })

    await expect(readAgentsGuide()).resolves.toEqual({
      ok: true,
      content: '# Base guide\n',
      hash: 'hash-1',
    })
  })

  it('appends workspace identity when a user is provided', async () => {
    mockReadConfigRepoFileBuffer.mockResolvedValue({
      ok: true,
      content: Buffer.from('# Base guide\n'),
      hash: 'hash-2',
    })

    const result = await readAgentsGuide({
      user: {
        email: 'alice@example.com',
        id: 'user-1',
        role: 'USER',
        slug: 'alice',
      },
    })

    expect(result).toEqual({
      ok: true,
      content: expect.stringContaining('## Workspace User Identity'),
      hash: 'hash-2',
    })
    expect(result.ok && result.content).toContain('- Slug: alice')
    expect(result.ok && result.content).toContain('- Email: alice@example.com')
  })

  it('propagates repo read errors', async () => {
    mockReadConfigRepoFileBuffer.mockResolvedValue({ ok: false, error: 'not_found' })

    await expect(readAgentsGuide()).resolves.toEqual({ ok: false, error: 'not_found' })
  })
})

import * as fs from 'node:fs/promises'
import * as os from 'node:os'
import * as path from 'node:path'

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  cleanupClone: vi.fn(),
  cloneRepoToTemp: vi.fn(),
}))

vi.mock('@/lib/git/bare-repo', () => ({
  cleanupClone: mocks.cleanupClone,
  cloneRepoToTemp: mocks.cloneRepoToTemp,
  detectDefaultBranch: vi.fn(),
  hasBareRepoLayout: vi.fn().mockResolvedValue(true),
  isGitAvailable: vi.fn().mockResolvedValue(true),
  resolveRepoRoot: vi.fn().mockResolvedValue('/kb-content.git'),
  runGit: vi.fn(),
}))

vi.mock('@/lib/runtime/paths', () => ({
  getKbContentRoot: () => '/kb-content',
}))

let repoDir: string | null = null

describe('searchKb', () => {
  beforeEach(async () => {
    vi.resetModules()
    vi.clearAllMocks()

    repoDir = await fs.mkdtemp(path.join(os.tmpdir(), 'arche-mcp-search-test-'))
    await fs.mkdir(path.join(repoDir, 'nested'))
    await fs.writeFile(path.join(repoDir, 'alpha.md'), 'first match\nsecond line', 'utf-8')
    await fs.writeFile(path.join(repoDir, 'nested', 'beta.md'), 'another match', 'utf-8')

    mocks.cloneRepoToTemp.mockResolvedValue({ ok: true, dir: repoDir, gitEnv: {} })
  })

  afterEach(async () => {
    if (repoDir) {
      await fs.rm(repoDir, { recursive: true, force: true })
      repoDir = null
    }
  })

  it('searches a cloned KB repo without cloning once per article', async () => {
    const { searchKb } = await import('@/lib/mcp/kb-content-store')

    const result = await searchKb({ query: 'match' })

    expect(result).toEqual({
      ok: true,
      matches: [
        { path: 'alpha.md', line: 1, text: 'first match' },
        { path: 'nested/beta.md', line: 1, text: 'another match' },
      ],
    })
    expect(mocks.cloneRepoToTemp).toHaveBeenCalledTimes(1)
  })
})

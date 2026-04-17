import * as fs from 'node:fs/promises'
import * as os from 'node:os'
import * as path from 'node:path'

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@/lib/git/bare-repo', () => ({
  cleanupClone: vi.fn(),
  cloneRepoToTemp: vi.fn(),
  detectDefaultBranch: vi.fn(),
  hasBareRepoLayout: vi.fn(),
  isGitAvailable: vi.fn(),
  resolveRepoRoot: vi.fn(),
  runGit: vi.fn(),
}))

vi.mock('@/lib/runtime/paths', () => ({
  getKbContentRoot: vi.fn(() => '/kb-content'),
}))

import {
  cleanupClone,
  cloneRepoToTemp,
  detectDefaultBranch,
  hasBareRepoLayout,
  isGitAvailable,
  resolveRepoRoot,
  runGit,
} from '@/lib/git/bare-repo'
import {
  deleteKbArticle,
  writeKbArticle,
} from '../write-kb-article'

const mockCleanupClone = vi.mocked(cleanupClone)
const mockCloneRepoToTemp = vi.mocked(cloneRepoToTemp)
const mockDetectDefaultBranch = vi.mocked(detectDefaultBranch)
const mockHasBareRepoLayout = vi.mocked(hasBareRepoLayout)
const mockIsGitAvailable = vi.mocked(isGitAvailable)
const mockResolveRepoRoot = vi.mocked(resolveRepoRoot)
const mockRunGit = vi.mocked(runGit)

function mockRunGitSuccessForMutations() {
  mockRunGit.mockImplementation(async (args: string[]) => {
    if (args[0] === 'status') {
      return { ok: true, stdout: 'M  docs/intro.md\n' }
    }
    if (args[0] === 'rev-parse') {
      return { ok: true, stdout: 'abc123\n' }
    }
    return { ok: true, stdout: '' }
  })
}

describe('kb write tools', () => {
  let repoDir = ''
  let safeConfigDir = ''

  beforeEach(async () => {
    vi.clearAllMocks()
    repoDir = await fs.mkdtemp(path.join(os.tmpdir(), 'arche-mcp-kb-write-'))
    safeConfigDir = await fs.mkdtemp(path.join(os.tmpdir(), 'arche-mcp-kb-safe-'))

    mockResolveRepoRoot.mockResolvedValue(repoDir)
    mockHasBareRepoLayout.mockResolvedValue(true)
    mockIsGitAvailable.mockResolvedValue(true)
    mockCloneRepoToTemp.mockResolvedValue({
      ok: true,
      dir: repoDir,
      gitEnv: {},
      safeConfigDir,
    })
    mockCleanupClone.mockResolvedValue()
    mockDetectDefaultBranch.mockResolvedValue('main')
    mockRunGitSuccessForMutations()
  })

  afterEach(async () => {
    await fs.rm(repoDir, { recursive: true, force: true }).catch(() => {})
    await fs.rm(safeConfigDir, { recursive: true, force: true }).catch(() => {})
  })

  it('writes an article and commits the change', async () => {
    const result = await writeKbArticle({
      path: 'docs/intro.md',
      content: '# Hello',
    })

    expect(result).toEqual({
      ok: true,
      hash: 'abc123',
      path: 'docs/intro.md',
    })
    expect(await fs.readFile(path.join(repoDir, 'docs/intro.md'), 'utf-8')).toBe('# Hello')
    expect(mockRunGit).toHaveBeenCalledWith(
      ['add', '-A', '--', 'docs/intro.md'],
      expect.objectContaining({ cwd: repoDir }),
    )
  })

  it('rejects unsafe write paths', async () => {
    const result = await writeKbArticle({
      path: '../../etc/passwd',
      content: 'nope',
    })

    expect(result).toEqual({ ok: false, error: 'invalid_path' })
    expect(mockCloneRepoToTemp).not.toHaveBeenCalled()
    expect(mockRunGit).not.toHaveBeenCalled()
  })

  it('deletes an existing article and commits the change', async () => {
    const filePath = path.join(repoDir, 'docs/delete-me.md')
    await fs.mkdir(path.dirname(filePath), { recursive: true })
    await fs.writeFile(filePath, 'bye', 'utf-8')

    const result = await deleteKbArticle({ path: 'docs/delete-me.md' })

    expect(result).toEqual({
      ok: true,
      hash: 'abc123',
      path: 'docs/delete-me.md',
    })
    await expect(fs.stat(filePath)).rejects.toThrow()
    expect(mockRunGit).toHaveBeenCalledWith(
      ['add', '-A', '--', 'docs/delete-me.md'],
      expect.objectContaining({ cwd: repoDir }),
    )
  })

  it('returns not_found when deleting a missing article', async () => {
    const result = await deleteKbArticle({ path: 'docs/missing.md' })

    expect(result).toEqual({ ok: false, error: 'not_found' })
    expect(mockRunGit).not.toHaveBeenCalled()
  })

  it('returns kb_unavailable when content repo root is unavailable', async () => {
    mockResolveRepoRoot.mockResolvedValue(null)

    const result = await writeKbArticle({
      path: 'docs/intro.md',
      content: '# Hello',
    })

    expect(result).toEqual({ ok: false, error: 'kb_unavailable' })
    expect(mockCloneRepoToTemp).not.toHaveBeenCalled()
  })
})

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import * as fs from 'node:fs/promises'
import * as path from 'node:path'
import { tmpdir } from 'node:os'

const { mockExecFile } = vi.hoisted(() => ({
  mockExecFile: vi.fn(),
}))

vi.mock('child_process', () => ({
  execFile: mockExecFile,
}))

vi.mock('util', () => ({
  promisify: (fn: unknown) => fn,
}))

import {
  runGit,
  isGitAvailable,
  hasBareRepoLayout,
  resolveRepoRoot,
  runGitOnBareRepo,
  detectDefaultBranch,
  hashContent,
} from '@/lib/git/bare-repo'

describe('hashContent', () => {
  it('returns a hex SHA-256 hash', () => {
    const hash = hashContent('hello world')
    expect(hash).toMatch(/^[0-9a-f]{64}$/)
  })

  it('returns consistent hashes for same input', () => {
    expect(hashContent('test')).toBe(hashContent('test'))
  })

  it('returns different hashes for different input', () => {
    expect(hashContent('a')).not.toBe(hashContent('b'))
  })
})

describe('runGit', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('returns stdout on success', async () => {
    mockExecFile.mockResolvedValue({ stdout: 'output\n' })
    const result = await runGit(['status'])
    expect(result).toEqual({ ok: true, stdout: 'output\n' })
  })

  it('returns empty stdout when null', async () => {
    mockExecFile.mockResolvedValue({ stdout: null })
    const result = await runGit(['status'])
    expect(result).toEqual({ ok: true, stdout: '' })
  })

  it('returns stderr on error with stderr property', async () => {
    mockExecFile.mockRejectedValue({ stderr: 'fatal: bad' })
    const result = await runGit(['status'])
    expect(result).toEqual({ ok: false, stderr: 'fatal: bad' })
  })

  it('returns git_failed for errors without stderr', async () => {
    mockExecFile.mockRejectedValue(new Error('ENOENT'))
    const result = await runGit(['status'])
    expect(result).toEqual({ ok: false, stderr: 'git_failed' })
  })

  it('passes cwd and env options', async () => {
    mockExecFile.mockResolvedValue({ stdout: '' })
    await runGit(['log'], { cwd: '/tmp', env: { MY_VAR: 'x' } })
    expect(mockExecFile).toHaveBeenCalledWith(
      'git',
      ['log'],
      expect.objectContaining({ cwd: '/tmp' }),
    )
    const callEnv = mockExecFile.mock.calls[0][2].env
    expect(callEnv.MY_VAR).toBe('x')
  })
})

describe('hasBareRepoLayout', () => {
  let tempDir: string

  beforeEach(async () => {
    tempDir = await fs.mkdtemp(path.join(tmpdir(), 'bare-test-'))
  })

  afterEach(async () => {
    await fs.rm(tempDir, { recursive: true, force: true })
  })

  it('returns true for valid bare repo layout', async () => {
    await fs.writeFile(path.join(tempDir, 'HEAD'), 'ref: refs/heads/main\n')
    await fs.mkdir(path.join(tempDir, 'objects'))
    await fs.mkdir(path.join(tempDir, 'refs'))

    expect(await hasBareRepoLayout(tempDir)).toBe(true)
  })

  it('returns false when HEAD is missing', async () => {
    await fs.mkdir(path.join(tempDir, 'objects'))
    await fs.mkdir(path.join(tempDir, 'refs'))

    expect(await hasBareRepoLayout(tempDir)).toBe(false)
  })

  it('returns false when objects is missing', async () => {
    await fs.writeFile(path.join(tempDir, 'HEAD'), 'ref')
    await fs.mkdir(path.join(tempDir, 'refs'))

    expect(await hasBareRepoLayout(tempDir)).toBe(false)
  })

  it('returns false when refs is missing', async () => {
    await fs.writeFile(path.join(tempDir, 'HEAD'), 'ref')
    await fs.mkdir(path.join(tempDir, 'objects'))

    expect(await hasBareRepoLayout(tempDir)).toBe(false)
  })

  it('returns false for nonexistent directory', async () => {
    expect(await hasBareRepoLayout('/nonexistent/path')).toBe(false)
  })
})

describe('resolveRepoRoot', () => {
  let tempDir: string

  beforeEach(async () => {
    tempDir = await fs.mkdtemp(path.join(tmpdir(), 'repo-root-'))
  })

  afterEach(async () => {
    await fs.rm(tempDir, { recursive: true, force: true })
  })

  it('returns the path when it is a directory', async () => {
    expect(await resolveRepoRoot(tempDir)).toBe(tempDir)
  })

  it('returns null when path is a file', async () => {
    const filePath = path.join(tempDir, 'file.txt')
    await fs.writeFile(filePath, 'data')
    expect(await resolveRepoRoot(filePath)).toBeNull()
  })

  it('returns null when path does not exist', async () => {
    expect(await resolveRepoRoot('/nonexistent/path')).toBeNull()
  })
})

describe('detectDefaultBranch', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('returns branch from symbolic-ref when available', async () => {
    mockExecFile.mockResolvedValue({ stdout: 'origin/develop\n' })
    const result = await detectDefaultBranch('/repo', {})
    expect(result).toBe('develop')
  })

  it('returns main when show-ref verifies origin/main', async () => {
    mockExecFile
      .mockRejectedValueOnce({ stderr: 'not symbolic' })
      .mockResolvedValueOnce({ stdout: '' })
    const result = await detectDefaultBranch('/repo', {})
    expect(result).toBe('main')
  })

  it('returns master when main is not found but master is', async () => {
    mockExecFile
      .mockRejectedValueOnce({ stderr: '' })
      .mockRejectedValueOnce({ stderr: '' })
      .mockResolvedValueOnce({ stdout: '' })
    const result = await detectDefaultBranch('/repo', {})
    expect(result).toBe('master')
  })

  it('defaults to main when neither main nor master exist', async () => {
    mockExecFile.mockRejectedValue({ stderr: '' })
    const result = await detectDefaultBranch('/repo', {})
    expect(result).toBe('main')
  })
})

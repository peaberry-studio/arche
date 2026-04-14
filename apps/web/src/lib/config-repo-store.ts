import * as fs from 'node:fs/promises'
import * as path from 'node:path'

import {
  cleanupClone,
  cloneRepoToTemp,
  detectDefaultBranch,
  hasBareRepoLayout,
  isGitAvailable,
  resolveRepoRoot,
  runGit,
} from '@/lib/git/bare-repo'
import { getKbConfigRoot } from '@/lib/runtime/paths'

export type ConfigRepoFileEntry = {
  content: Buffer
  path: string
}

type ConfigRepoReadError = 'kb_unavailable' | 'read_failed'

export type ConfigRepoMutationResult =
  | { ok: true; hash: string }
  | { ok: false; error: 'conflict' | 'kb_unavailable' | 'write_failed' }

type MutateConfigRepoArgs = {
  commitMessage: string
  expectedHash?: string
  mutate: (context: { repoDir: string }) => Promise<string[]>
}

function normalizeRepoRelativePath(input: string): string {
  const normalized = input
    .trim()
    .replace(/\\/g, '/')
    .replace(/^\/+/, '')
    .replace(/\/+/g, '/')

  const segments = normalized
    .split('/')
    .filter((segment) => segment.length > 0 && segment !== '.')

  if (segments.some((segment) => segment === '..')) {
    throw new Error('invalid_repo_path')
  }

  return segments.join('/')
}

async function resolveConfigRepoRoot(): Promise<string | null> {
  return resolveRepoRoot(getKbConfigRoot())
}

async function getCloneHeadHash(repoDir: string, gitEnv: NodeJS.ProcessEnv): Promise<string | null> {
  const head = await runGit(['rev-parse', 'HEAD'], { cwd: repoDir, env: gitEnv })
  if (!head.ok) return null

  const hash = head.stdout.trim()
  return hash.length > 0 ? hash : null
}

async function listFilesRecursive(rootDir: string, prefix = ''): Promise<ConfigRepoFileEntry[]> {
  const entries = await fs.readdir(rootDir, { withFileTypes: true })
  const files: ConfigRepoFileEntry[] = []

  for (const entry of entries.sort((left, right) => left.name.localeCompare(right.name))) {
    const absolutePath = path.join(rootDir, entry.name)
    const relativePath = prefix ? `${prefix}/${entry.name}` : entry.name

    if (entry.isDirectory()) {
      files.push(...await listFilesRecursive(absolutePath, relativePath))
      continue
    }

    if (!entry.isFile()) {
      continue
    }

    files.push({
      path: relativePath,
      content: await fs.readFile(absolutePath),
    })
  }

  return files
}

export async function readConfigRepoSnapshot<T>(
  reader: (context: { repoDir: string; hash: string | null }) => Promise<T>
): Promise<{ ok: true; data: T; hash: string | null } | { ok: false; error: ConfigRepoReadError }> {
  const root = await resolveConfigRepoRoot()
  if (!root) return { ok: false, error: 'kb_unavailable' }

  if (!(await hasBareRepoLayout(root))) {
    return { ok: false, error: 'kb_unavailable' }
  }

  if (!(await isGitAvailable())) {
    return { ok: false, error: 'read_failed' }
  }

  const clone = await cloneRepoToTemp(root)
  if (!clone.ok) {
    return { ok: false, error: 'read_failed' }
  }

  try {
    const hash = await getCloneHeadHash(clone.dir, clone.gitEnv)
    const data = await reader({ repoDir: clone.dir, hash })
    return { ok: true, data, hash }
  } finally {
    await cleanupClone(clone)
  }
}

export async function getConfigRepoHash(): Promise<
  | { ok: true; hash: string | null }
  | { ok: false; error: ConfigRepoReadError }
> {
  const root = await resolveConfigRepoRoot()
  if (!root) return { ok: false, error: 'kb_unavailable' }

  if (!(await hasBareRepoLayout(root))) {
    return { ok: false, error: 'kb_unavailable' }
  }

  if (!(await isGitAvailable())) {
    return { ok: false, error: 'read_failed' }
  }

  const clone = await cloneRepoToTemp(root)
  if (!clone.ok) {
    return { ok: false, error: 'read_failed' }
  }

  try {
    return { ok: true, hash: await getCloneHeadHash(clone.dir, clone.gitEnv) }
  } finally {
    await cleanupClone(clone)
  }
}

export async function readConfigRepoFileBuffer(
  filePath: string
): Promise<{ ok: true; content: Buffer; hash: string | null } | { ok: false; error: 'not_found' | ConfigRepoReadError }> {
  const root = await resolveConfigRepoRoot()
  if (!root) return { ok: false, error: 'kb_unavailable' }

  if (!(await hasBareRepoLayout(root))) {
    return { ok: false, error: 'kb_unavailable' }
  }

  if (!(await isGitAvailable())) {
    return { ok: false, error: 'read_failed' }
  }

  const clone = await cloneRepoToTemp(root)
  if (!clone.ok) {
    return { ok: false, error: 'read_failed' }
  }

  try {
    const normalizedPath = normalizeRepoRelativePath(filePath)
    const absolutePath = path.join(clone.dir, normalizedPath)
    const content = await fs.readFile(absolutePath)

    return {
      ok: true,
      content,
      hash: await getCloneHeadHash(clone.dir, clone.gitEnv),
    }
  } catch (error) {
    if (error && typeof error === 'object' && 'code' in error && error.code === 'ENOENT') {
      return { ok: false, error: 'not_found' }
    }

    return { ok: false, error: 'read_failed' }
  } finally {
    await cleanupClone(clone)
  }
}

export async function listConfigRepoFiles(
  directoryPath: string
): Promise<{ ok: true; files: ConfigRepoFileEntry[]; hash: string | null } | { ok: false; error: ConfigRepoReadError }> {
  const root = await resolveConfigRepoRoot()
  if (!root) return { ok: false, error: 'kb_unavailable' }

  if (!(await hasBareRepoLayout(root))) {
    return { ok: false, error: 'kb_unavailable' }
  }

  if (!(await isGitAvailable())) {
    return { ok: false, error: 'read_failed' }
  }

  const clone = await cloneRepoToTemp(root)
  if (!clone.ok) {
    return { ok: false, error: 'read_failed' }
  }

  try {
    const normalizedPath = normalizeRepoRelativePath(directoryPath)
    const absolutePath = path.join(clone.dir, normalizedPath)
    const stats = await fs.stat(absolutePath).catch(() => null)

    return {
      ok: true,
      files: stats?.isDirectory() ? await listFilesRecursive(absolutePath, normalizedPath) : [],
      hash: await getCloneHeadHash(clone.dir, clone.gitEnv),
    }
  } catch {
    return { ok: false, error: 'read_failed' }
  } finally {
    await cleanupClone(clone)
  }
}

export async function mutateConfigRepo({
  commitMessage,
  expectedHash,
  mutate,
}: MutateConfigRepoArgs): Promise<ConfigRepoMutationResult> {
  const root = await resolveConfigRepoRoot()
  if (!root) return { ok: false, error: 'kb_unavailable' }

  if (!(await hasBareRepoLayout(root))) {
    return { ok: false, error: 'kb_unavailable' }
  }

  if (!(await isGitAvailable())) {
    return { ok: false, error: 'write_failed' }
  }

  const clone = await cloneRepoToTemp(root)
  if (!clone.ok) {
    return { ok: false, error: 'write_failed' }
  }

  try {
    const currentHash = await getCloneHeadHash(clone.dir, clone.gitEnv)
    if (expectedHash && currentHash && expectedHash !== currentHash) {
      return { ok: false, error: 'conflict' }
    }

    const changedPaths = Array.from(new Set((await mutate({ repoDir: clone.dir })).map(normalizeRepoRelativePath)))
    if (changedPaths.length === 0) {
      return { ok: true, hash: currentHash ?? '' }
    }

    const add = await runGit(['add', '-A', '--', ...changedPaths], {
      cwd: clone.dir,
      env: clone.gitEnv,
    })
    if (!add.ok) {
      return { ok: false, error: 'write_failed' }
    }

    const status = await runGit(['status', '--porcelain', '--', ...changedPaths], {
      cwd: clone.dir,
      env: clone.gitEnv,
    })
    if (!status.ok) {
      return { ok: false, error: 'write_failed' }
    }

    if (!status.stdout.trim()) {
      return { ok: true, hash: currentHash ?? '' }
    }

    const commit = await runGit(
      [
        '-c', 'user.name=Arche Config',
        '-c', 'user.email=config@arche.local',
        'commit',
        '-m', commitMessage,
      ],
      { cwd: clone.dir, env: clone.gitEnv }
    )
    if (!commit.ok) {
      return { ok: false, error: 'write_failed' }
    }

    const branch = await detectDefaultBranch(clone.dir, clone.gitEnv)
    const push = await runGit(['push', 'origin', `HEAD:refs/heads/${branch}`], {
      cwd: clone.dir,
      env: clone.gitEnv,
    })
    if (!push.ok) {
      if (push.stderr.includes('non-fast-forward')) {
        return { ok: false, error: 'conflict' }
      }

      return { ok: false, error: 'write_failed' }
    }

    return { ok: true, hash: (await getCloneHeadHash(clone.dir, clone.gitEnv)) ?? '' }
  } finally {
    await cleanupClone(clone)
  }
}

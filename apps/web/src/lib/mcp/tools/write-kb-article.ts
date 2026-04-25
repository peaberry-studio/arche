import { constants as fsConstants } from 'node:fs'
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
import { normalizeKbWritePath } from '@/lib/mcp/tools/path'
import { getKbContentRoot } from '@/lib/runtime/paths'

type CreateKbArticleInput = {
  content: string
  path: string
}

type UpdateKbArticleInput = {
  content: string
  path: string
}

type DeleteKbArticleInput = {
  path: string
}

type CreateKbArticleResult =
  | { ok: true; path: string; hash: string }
  | { ok: false; error: 'invalid_path' | 'kb_unavailable' | 'already_exists' | 'write_failed' | 'conflict' }

type UpdateKbArticleResult =
  | { ok: true; path: string; hash: string }
  | { ok: false; error: 'invalid_path' | 'kb_unavailable' | 'not_found' | 'write_failed' | 'conflict' }

type DeleteKbArticleResult =
  | { ok: true; path: string; hash: string }
  | { ok: false; error: 'invalid_path' | 'kb_unavailable' | 'not_found' | 'write_failed' | 'conflict' }

type MutateKbRepoResult<CustomError extends string> =
  | { ok: true; hash: string }
  | { ok: false; error: 'invalid_path' | 'kb_unavailable' | 'write_failed' | 'conflict' | CustomError }

type SafeTargetResult =
  | { ok: true; absolutePath: string }
  | { ok: false; error: 'invalid_path' | 'parent_missing' }

export async function createKbArticle(input: CreateKbArticleInput): Promise<CreateKbArticleResult> {
  const normalizedPath = normalizeKbWritePath(input.path)
  if (!normalizedPath) {
    return { ok: false, error: 'invalid_path' }
  }

  const result = await mutateKbRepo<'already_exists'>({
    commitMessage: `Create KB article: ${normalizedPath}`,
    path: normalizedPath,
    mutate: async (cloneDir, relativePath) => {
      const target = await resolveSafeTarget(cloneDir, relativePath, true)
      if (!target.ok) {
        return { ok: false as const, error: 'invalid_path' as const }
      }

      const existing = await fs.lstat(target.absolutePath).catch(() => null)
      if (existing) {
        if (existing.isSymbolicLink()) {
          return { ok: false as const, error: 'invalid_path' as const }
        }
        return { ok: false as const, error: 'already_exists' as const }
      }

      const written = await writeFileNoFollow(target.absolutePath, input.content, true)
      if (!written.ok) {
        return written
      }
      return { ok: true }
    },
  })

  if (!result.ok) {
    return result
  }

  return {
    ok: true,
    path: normalizedPath,
    hash: result.hash,
  }
}

export async function updateKbArticle(input: UpdateKbArticleInput): Promise<UpdateKbArticleResult> {
  const normalizedPath = normalizeKbWritePath(input.path)
  if (!normalizedPath) {
    return { ok: false, error: 'invalid_path' }
  }

  const result = await mutateKbRepo<'not_found'>({
    commitMessage: `Update KB article: ${normalizedPath}`,
    path: normalizedPath,
    mutate: async (cloneDir, relativePath) => {
      const target = await resolveSafeTarget(cloneDir, relativePath, false)
      if (!target.ok) {
        return {
          ok: false as const,
          error: target.error === 'parent_missing' ? 'not_found' as const : 'invalid_path' as const,
        }
      }

      const existing = await fs.lstat(target.absolutePath).catch(() => null)
      if (existing?.isSymbolicLink()) {
        return { ok: false as const, error: 'invalid_path' as const }
      }
      if (!existing?.isFile()) {
        return { ok: false as const, error: 'not_found' as const }
      }

      const written = await writeFileNoFollow(target.absolutePath, input.content, false)
      if (!written.ok) {
        return {
          ok: false as const,
          error: written.error === 'already_exists' ? 'write_failed' as const : written.error,
        }
      }
      return { ok: true as const }
    },
  })

  if (!result.ok) {
    return result
  }

  return {
    ok: true,
    path: normalizedPath,
    hash: result.hash,
  }
}

export async function deleteKbArticle(input: DeleteKbArticleInput): Promise<DeleteKbArticleResult> {
  const normalizedPath = normalizeKbWritePath(input.path)
  if (!normalizedPath) {
    return { ok: false, error: 'invalid_path' }
  }

  const result = await mutateKbRepo<'not_found'>({
    commitMessage: `Delete KB article: ${normalizedPath}`,
    path: normalizedPath,
    mutate: async (cloneDir, relativePath) => {
      const target = await resolveSafeTarget(cloneDir, relativePath, false)
      if (!target.ok) {
        return {
          ok: false as const,
          error: target.error === 'parent_missing' ? 'not_found' as const : 'invalid_path' as const,
        }
      }

      const stats = await fs.lstat(target.absolutePath).catch(() => null)
      if (stats?.isSymbolicLink()) {
        return { ok: false as const, error: 'invalid_path' as const }
      }
      if (!stats?.isFile()) {
        return { ok: false as const, error: 'not_found' as const }
      }

      await fs.rm(target.absolutePath)
      return { ok: true as const }
    },
  })

  if (!result.ok) {
    return result
  }

  return {
    ok: true,
    path: normalizedPath,
    hash: result.hash,
  }
}

async function mutateKbRepo<CustomError extends string>(input: {
  commitMessage: string
  path: string
  mutate: (cloneDir: string, relativePath: string) => Promise<
    | { ok: true }
    | { ok: false; error: 'invalid_path' | 'write_failed' | CustomError }
  >
}): Promise<MutateKbRepoResult<CustomError>> {
  const root = await resolveRepoRoot(getKbContentRoot())
  if (!root) {
    return { ok: false, error: 'kb_unavailable' }
  }

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
    const mutateResult = await input.mutate(clone.dir, input.path)
    if (!mutateResult.ok) {
      return mutateResult
    }

    const add = await runGit(['add', '-A', '--', input.path], {
      cwd: clone.dir,
      env: clone.gitEnv,
    })
    if (!add.ok) {
      return { ok: false, error: 'write_failed' }
    }

    const status = await runGit(['status', '--porcelain', '--', input.path], {
      cwd: clone.dir,
      env: clone.gitEnv,
    })
    if (!status.ok) {
      return { ok: false, error: 'write_failed' }
    }

    if (!status.stdout.trim()) {
      return { ok: true, hash: (await getHeadHash(clone.dir, clone.gitEnv)) ?? '' }
    }

    const commit = await runGit(
      [
        '-c', 'user.name=Arche MCP',
        '-c', 'user.email=mcp@arche.local',
        'commit',
        '-m', input.commitMessage,
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
      if (isNonFastForwardPush(push.stderr)) {
        return { ok: false, error: 'conflict' }
      }
      return { ok: false, error: 'write_failed' }
    }

    return { ok: true, hash: (await getHeadHash(clone.dir, clone.gitEnv)) ?? '' }
  } catch {
    return { ok: false, error: 'write_failed' }
  } finally {
    await cleanupClone(clone)
  }
}

async function resolveSafeTarget(
  cloneDir: string,
  relativePath: string,
  createParents: boolean
): Promise<SafeTargetResult> {
  const cloneRealPath = await fs.realpath(cloneDir)
  const absolutePath = path.resolve(cloneRealPath, relativePath)
  if (!isInsidePath(cloneRealPath, absolutePath)) {
    return { ok: false, error: 'invalid_path' }
  }

  const segments = relativePath.split('/')
  let cursor = cloneRealPath
  for (const segment of segments.slice(0, -1)) {
    cursor = path.join(cursor, segment)
    const stats = await fs.lstat(cursor).catch((error: unknown) => {
      if (isNodeErrorCode(error, 'ENOENT')) {
        return null
      }

      throw error
    })

    if (!stats) {
      if (!createParents) {
        return { ok: false, error: 'parent_missing' }
      }

      await fs.mkdir(cursor)
      const createdStats = await fs.lstat(cursor)
      if (!createdStats.isDirectory() || createdStats.isSymbolicLink()) {
        return { ok: false, error: 'invalid_path' }
      }
    } else if (!stats.isDirectory() || stats.isSymbolicLink()) {
      return { ok: false, error: 'invalid_path' }
    }

    const realParent = await fs.realpath(cursor)
    if (!isInsidePath(cloneRealPath, realParent)) {
      return { ok: false, error: 'invalid_path' }
    }
  }

  return { ok: true, absolutePath }
}

async function writeFileNoFollow(
  filePath: string,
  content: string,
  createNew: boolean
): Promise<{ ok: true } | { ok: false; error: 'invalid_path' | 'write_failed' | 'already_exists' }> {
  if (typeof fsConstants.O_NOFOLLOW !== 'number') {
    return { ok: false, error: 'write_failed' }
  }

  const flags = createNew
    ? fsConstants.O_WRONLY | fsConstants.O_CREAT | fsConstants.O_EXCL | fsConstants.O_NOFOLLOW
    : fsConstants.O_WRONLY | fsConstants.O_TRUNC | fsConstants.O_NOFOLLOW

  let handle: fs.FileHandle | null = null
  try {
    handle = await fs.open(filePath, flags, 0o666)
    await handle.writeFile(content, 'utf-8')
    return { ok: true }
  } catch (error) {
    if (isNodeErrorCode(error, 'EEXIST')) {
      return { ok: false, error: 'already_exists' }
    }

    if (isNodeErrorCode(error, 'ELOOP')) {
      return { ok: false, error: 'invalid_path' }
    }

    return { ok: false, error: 'write_failed' }
  } finally {
    await handle?.close().catch(() => undefined)
  }
}

function isInsidePath(root: string, target: string): boolean {
  const relative = path.relative(root, target)
  return relative === '' || (!relative.startsWith('..') && !path.isAbsolute(relative))
}

function isNodeErrorCode(error: unknown, code: string): boolean {
  return Boolean(error && typeof error === 'object' && 'code' in error && (error as { code?: unknown }).code === code)
}

function isNonFastForwardPush(stderr: string): boolean {
  const normalized = stderr.toLowerCase()
  return (
    normalized.includes('non-fast-forward') ||
    normalized.includes('fetch first') ||
    normalized.includes('[rejected]')
  )
}

async function getHeadHash(repoDir: string, gitEnv: NodeJS.ProcessEnv): Promise<string | null> {
  const head = await runGit(['rev-parse', 'HEAD'], { cwd: repoDir, env: gitEnv })
  if (!head.ok) {
    return null
  }

  const hash = head.stdout.trim()
  return hash.length > 0 ? hash : null
}

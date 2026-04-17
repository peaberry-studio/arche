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
import { normalizeKbPath } from '@/lib/mcp/tools/path'
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
  | { ok: false; error: 'invalid_path' | 'kb_unavailable' | 'already_exists' | 'write_failed' }

type UpdateKbArticleResult =
  | { ok: true; path: string; hash: string }
  | { ok: false; error: 'invalid_path' | 'kb_unavailable' | 'not_found' | 'write_failed' }

type DeleteKbArticleResult =
  | { ok: true; path: string; hash: string }
  | { ok: false; error: 'invalid_path' | 'kb_unavailable' | 'not_found' | 'write_failed' }

type MutateKbRepoResult<CustomError extends string> =
  | { ok: true; hash: string }
  | { ok: false; error: 'kb_unavailable' | 'write_failed' | CustomError }

export async function createKbArticle(input: CreateKbArticleInput): Promise<CreateKbArticleResult> {
  const normalizedPath = normalizeKbPath(input.path)
  if (!normalizedPath) {
    return { ok: false, error: 'invalid_path' }
  }

  const result = await mutateKbRepo<'already_exists'>({
    commitMessage: `Create KB article: ${normalizedPath}`,
    path: normalizedPath,
    mutate: async (absolutePath) => {
      const existing = await fs.stat(absolutePath).catch(() => null)
      if (existing) {
        return { ok: false as const, error: 'already_exists' as const }
      }

      await fs.mkdir(path.dirname(absolutePath), { recursive: true })
      await fs.writeFile(absolutePath, input.content, 'utf-8')
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
  const normalizedPath = normalizeKbPath(input.path)
  if (!normalizedPath) {
    return { ok: false, error: 'invalid_path' }
  }

  const result = await mutateKbRepo<'not_found'>({
    commitMessage: `Update KB article: ${normalizedPath}`,
    path: normalizedPath,
    mutate: async (absolutePath) => {
      const existing = await fs.stat(absolutePath).catch(() => null)
      if (!existing?.isFile()) {
        return { ok: false as const, error: 'not_found' as const }
      }

      await fs.writeFile(absolutePath, input.content, 'utf-8')
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
  const normalizedPath = normalizeKbPath(input.path)
  if (!normalizedPath) {
    return { ok: false, error: 'invalid_path' }
  }

  const result = await mutateKbRepo<'not_found'>({
    commitMessage: `Delete KB article: ${normalizedPath}`,
    path: normalizedPath,
    mutate: async (absolutePath) => {
      const stats = await fs.stat(absolutePath).catch(() => null)
      if (!stats?.isFile()) {
        return { ok: false as const, error: 'not_found' as const }
      }

      await fs.rm(absolutePath)
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
  mutate: (absolutePath: string) => Promise<
    | { ok: true }
    | { ok: false; error: CustomError }
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
    const absolutePath = path.join(clone.dir, input.path)
    const mutateResult = await input.mutate(absolutePath)
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
      return { ok: false, error: 'write_failed' }
    }

    return { ok: true, hash: (await getHeadHash(clone.dir, clone.gitEnv)) ?? '' }
  } catch {
    return { ok: false, error: 'write_failed' }
  } finally {
    await cleanupClone(clone)
  }
}

async function getHeadHash(repoDir: string, gitEnv: NodeJS.ProcessEnv): Promise<string | null> {
  const head = await runGit(['rev-parse', 'HEAD'], { cwd: repoDir, env: gitEnv })
  if (!head.ok) {
    return null
  }

  const hash = head.stdout.trim()
  return hash.length > 0 ? hash : null
}

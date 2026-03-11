import { promises as fs } from 'fs'
import path from 'path'

import {
  cleanupClone,
  cloneRepoToTemp,
  detectDefaultBranch,
  hasBareRepoLayout,
  isGitAvailable,
  resolveRepoRoot,
  runGit,
} from '@/lib/git/bare-repo'
import { normalizeRepoPath } from '@/kickstart/parse-utils'
import type { KickstartRenderedFile } from '@/kickstart/types'

const CONFIG_REPO_ROOT = '/kb-config'
const CONTENT_REPO_ROOT = '/kb-content'

type CommitPushResult =
  | { ok: true }
  | { ok: false; error: 'conflict' | 'write_failed' }

export type KickstartRepoWriteResult =
  | { ok: true }
  | { ok: false; error: 'conflict' | 'kb_unavailable' | 'write_failed' }

export type KickstartRepoPathRequirement = {
  path: string
  type: 'file' | 'dir'
}

function isPushConflict(stderr: string): boolean {
  return (
    stderr.includes('non-fast-forward') ||
    stderr.includes('fetch first') ||
    stderr.includes('[rejected]')
  )
}

export async function resolveKickstartConfigRepoRoot(): Promise<string | null> {
  return resolveRepoRoot(CONFIG_REPO_ROOT)
}

export async function resolveKickstartContentRepoRoot(): Promise<string | null> {
  return resolveRepoRoot(CONTENT_REPO_ROOT)
}

async function ensureBranch(
  repoDir: string,
  branch: string,
  gitEnv: NodeJS.ProcessEnv
): Promise<boolean> {
  const checkout = await runGit(['checkout', branch], { cwd: repoDir, env: gitEnv })
  if (checkout.ok) return true

  const create = await runGit(['checkout', '-b', branch], { cwd: repoDir, env: gitEnv })
  return create.ok
}

async function withBareRepoCheckout<T>(
  root: string,
  operation: (args: {
    dir: string
    branch: string
    gitEnv: NodeJS.ProcessEnv
  }) => Promise<T>
): Promise<{ ok: true; value: T } | { ok: false; error: 'write_failed' }> {
  if (!(await isGitAvailable())) {
    return { ok: false, error: 'write_failed' }
  }

  const clone = await cloneRepoToTemp(root)
  if (!clone.ok) {
    return { ok: false, error: 'write_failed' }
  }

  try {
    const branch = await detectDefaultBranch(clone.dir, clone.gitEnv)
    const ready = await ensureBranch(clone.dir, branch, clone.gitEnv)
    if (!ready) {
      return { ok: false, error: 'write_failed' }
    }

    const value = await operation({ dir: clone.dir, branch, gitEnv: clone.gitEnv })
    return { ok: true, value }
  } finally {
    await cleanupClone(clone)
  }
}

async function commitAndPush(
  repoDir: string,
  branch: string,
  commitMessage: string,
  gitEnv: NodeJS.ProcessEnv
): Promise<CommitPushResult> {
  const add = await runGit(['add', '-A'], { cwd: repoDir, env: gitEnv })
  if (!add.ok) {
    return { ok: false, error: 'write_failed' }
  }

  const status = await runGit(['status', '--porcelain'], { cwd: repoDir, env: gitEnv })
  if (!status.ok) {
    return { ok: false, error: 'write_failed' }
  }

  if (!status.stdout.trim()) {
    return { ok: true }
  }

  const commit = await runGit(
    [
      '-c',
      'user.name=Arche Kickstart',
      '-c',
      'user.email=kickstart@arche.local',
      'commit',
      '-m',
      commitMessage,
    ],
    { cwd: repoDir, env: gitEnv }
  )
  if (!commit.ok) {
    return { ok: false, error: 'write_failed' }
  }

  const push = await runGit(['push', 'origin', `HEAD:refs/heads/${branch}`], {
    cwd: repoDir,
    env: gitEnv,
  })
  if (!push.ok) {
    if (isPushConflict(push.stderr)) {
      return { ok: false, error: 'conflict' }
    }
    return { ok: false, error: 'write_failed' }
  }

  return { ok: true }
}

async function clearDirectoryExceptGit(root: string): Promise<void> {
  const entries = await fs.readdir(root)
  await Promise.all(
    entries
      .filter((entry) => entry !== '.git')
      .map((entry) =>
        fs.rm(path.join(root, entry), {
          recursive: true,
          force: true,
        })
      )
  )
}

async function writeTextFiles(
  root: string,
  files: Record<string, string>
): Promise<boolean> {
  const entries = Object.entries(files).sort(([a], [b]) => a.localeCompare(b))

  for (const [rawPath, content] of entries) {
    const safePath = normalizeRepoPath(rawPath)
    if (!safePath) {
      return false
    }

    const absolute = path.join(root, safePath)
    await fs.mkdir(path.dirname(absolute), { recursive: true })
    await fs.writeFile(absolute, content, 'utf-8')
  }

  return true
}

async function writeContentTree(
  root: string,
  directories: string[],
  files: KickstartRenderedFile[]
): Promise<boolean> {
  for (const rawDirectory of directories.sort((a, b) => a.localeCompare(b))) {
    const safePath = normalizeRepoPath(rawDirectory)
    if (!safePath) {
      return false
    }
    await fs.mkdir(path.join(root, safePath), { recursive: true })
  }

  for (const file of files.sort((a, b) => a.path.localeCompare(b.path))) {
    const safePath = normalizeRepoPath(file.path)
    if (!safePath) {
      return false
    }
    const absolute = path.join(root, safePath)
    await fs.mkdir(path.dirname(absolute), { recursive: true })
    await fs.writeFile(absolute, file.content, 'utf-8')
  }

  return true
}

async function fileMatchesContent(filePath: string, expectedContent: string): Promise<boolean> {
  try {
    const actualContent = await fs.readFile(filePath, 'utf-8')
    return actualContent === expectedContent
  } catch {
    return false
  }
}

async function textFilesMatch(root: string, files: Record<string, string>): Promise<boolean> {
  const entries = Object.entries(files).sort(([a], [b]) => a.localeCompare(b))

  for (const [rawPath, expectedContent] of entries) {
    const safePath = normalizeRepoPath(rawPath)
    if (!safePath) {
      return false
    }

    const absolutePath = path.join(root, safePath)
    const matches = await fileMatchesContent(absolutePath, expectedContent)
    if (!matches) {
      return false
    }
  }

  return true
}

async function contentTreeMatches(
  root: string,
  directories: string[],
  files: KickstartRenderedFile[]
): Promise<boolean> {
  for (const rawDirectory of directories) {
    const safePath = normalizeRepoPath(rawDirectory)
    if (!safePath) {
      return false
    }

    try {
      const stats = await fs.stat(path.join(root, safePath))
      if (!stats.isDirectory()) {
        return false
      }
    } catch {
      return false
    }
  }

  for (const file of files) {
    const safePath = normalizeRepoPath(file.path)
    if (!safePath) {
      return false
    }

    const absolutePath = path.join(root, safePath)
    const matches = await fileMatchesContent(absolutePath, file.content)
    if (!matches) {
      return false
    }
  }

  return true
}

export async function bareRepoPathsExist(
  repoPath: string,
  requiredPaths: KickstartRepoPathRequirement[]
): Promise<boolean> {
  if (!(await isGitAvailable())) {
    return false
  }

  const normalized = requiredPaths
    .map((requiredPath) => {
      const safePath = normalizeRepoPath(requiredPath.path)
      if (!safePath) return null
      return {
        safePath,
        type: requiredPath.type,
      }
    })
    .filter((entry): entry is { safePath: string; type: 'file' | 'dir' } => Boolean(entry))

  if (normalized.length !== requiredPaths.length) {
    return false
  }

  const tree = await runGit(['--git-dir', repoPath, 'ls-tree', '-r', '--name-only', 'HEAD'])
  if (!tree.ok) {
    return false
  }

  const trackedFiles = tree.stdout
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line.length > 0)
  const trackedFileSet = new Set(trackedFiles)

  for (const requiredPath of normalized) {
    if (requiredPath.type === 'file') {
      if (!trackedFileSet.has(requiredPath.safePath)) {
        return false
      }
      continue
    }

    if (
      !trackedFileSet.has(requiredPath.safePath) &&
      !trackedFiles.some((trackedPath) => trackedPath.startsWith(`${requiredPath.safePath}/`))
    ) {
      return false
    }
  }

  return true
}

export async function contentRepoPathsExist(
  requiredPaths: KickstartRepoPathRequirement[]
): Promise<boolean> {
  const root = await resolveKickstartContentRepoRoot()
  if (!root) return false

  if (!(await hasBareRepoLayout(root))) {
    return false
  }

  return bareRepoPathsExist(root, requiredPaths)
}

export async function contentRepoHasTrackedFiles(): Promise<boolean> {
  const root = await resolveKickstartContentRepoRoot()
  if (!root) return false

  if (!(await hasBareRepoLayout(root))) {
    return false
  }

  const tree = await runGit(['--git-dir', root, 'ls-tree', '-r', '--name-only', 'HEAD'])
  if (!tree.ok) {
    return false
  }

  return tree.stdout
    .split('\n')
    .map((line) => line.trim())
    .some((line) => line.length > 0)
}

export async function contentRepoPathExists(
  repoPath: string,
  expectedType: 'file' | 'dir'
): Promise<boolean> {
  return contentRepoPathsExist([{ path: repoPath, type: expectedType }])
}

export async function writeKickstartConfigRepo(
  files: Record<string, string>
): Promise<KickstartRepoWriteResult> {
  const root = await resolveKickstartConfigRepoRoot()
  if (!root) {
    return { ok: false, error: 'kb_unavailable' }
  }

  if (!(await hasBareRepoLayout(root))) {
    return { ok: false, error: 'write_failed' }
  }

  const result = await withBareRepoCheckout(root, async ({ dir, branch, gitEnv }) => {
    if (await textFilesMatch(dir, files)) {
      return { ok: true as const }
    }

    const written = await writeTextFiles(dir, files)
    if (!written) {
      return { ok: false as const, error: 'write_failed' as const }
    }

    return commitAndPush(dir, branch, 'Apply kickstart config', gitEnv)
  })

  if (!result.ok) {
    return { ok: false, error: 'write_failed' }
  }

  if (!result.value.ok) {
    return { ok: false, error: result.value.error }
  }

  return { ok: true }
}

export async function replaceKickstartContentRepo(args: {
  directories: string[]
  files: KickstartRenderedFile[]
}): Promise<KickstartRepoWriteResult> {
  const root = await resolveKickstartContentRepoRoot()
  if (!root) {
    return { ok: false, error: 'kb_unavailable' }
  }

  if (!(await hasBareRepoLayout(root))) {
    return { ok: false, error: 'write_failed' }
  }

  const result = await withBareRepoCheckout(root, async ({ dir, branch, gitEnv }) => {
    if (await contentTreeMatches(dir, args.directories, args.files)) {
      return { ok: true as const }
    }

    await clearDirectoryExceptGit(dir)
    const written = await writeContentTree(dir, args.directories, args.files)
    if (!written) {
      return { ok: false as const, error: 'write_failed' as const }
    }

    return commitAndPush(dir, branch, 'Apply kickstart KB template', gitEnv)
  })

  if (!result.ok) {
    return { ok: false, error: 'write_failed' }
  }

  if (!result.value.ok) {
    return { ok: false, error: result.value.error }
  }

  return { ok: true }
}

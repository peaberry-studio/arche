import { execFile } from 'child_process'
import { promises as fs } from 'fs'
import { tmpdir } from 'os'
import path from 'path'
import { promisify } from 'util'

import { normalizeRepoPath } from '@/kickstart/parse-utils'
import type { KickstartRenderedFile } from '@/kickstart/types'

const CONFIG_REPO_ENV = 'ARCHE_CONFIG_REPO_PATH'
const CONTENT_REPO_ENV = 'ARCHE_KB_CONTENT_PATH'

const execFileAsync = promisify(execFile)

let gitAvailabilityCache: boolean | null = null

type RepoMode = 'bare' | 'worktree' | 'directory'

type GitResult =
  | { ok: true; stdout: string }
  | { ok: false; stderr: string }

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

async function runGit(
  args: string[],
  options?: { cwd?: string }
): Promise<GitResult> {
  try {
    const result = await execFileAsync('git', args, {
      cwd: options?.cwd,
      encoding: 'utf-8',
    })
    return { ok: true, stdout: result.stdout ?? '' }
  } catch (error) {
    if (error && typeof error === 'object' && 'stderr' in error) {
      return {
        ok: false,
        stderr: String((error as { stderr?: string }).stderr ?? ''),
      }
    }
    return { ok: false, stderr: 'git_failed' }
  }
}

async function isGitAvailable(): Promise<boolean> {
  if (gitAvailabilityCache !== null) return gitAvailabilityCache
  const result = await runGit(['--version'])
  gitAvailabilityCache = result.ok
  return gitAvailabilityCache
}

async function hasBareRepoLayout(root: string): Promise<boolean> {
  try {
    const [head, objects, refs] = await Promise.all([
      fs.stat(path.join(root, 'HEAD')),
      fs.stat(path.join(root, 'objects')),
      fs.stat(path.join(root, 'refs')),
    ])
    return head.isFile() && objects.isDirectory() && refs.isDirectory()
  } catch {
    return false
  }
}

async function isWorktreeRepository(root: string): Promise<boolean> {
  const result = await runGit(['-C', root, 'rev-parse', '--show-toplevel'])
  if (!result.ok) return false
  return path.resolve(result.stdout.trim()) === path.resolve(root)
}

async function detectRepoMode(root: string): Promise<RepoMode> {
  if (await hasBareRepoLayout(root)) return 'bare'
  if (await isWorktreeRepository(root)) return 'worktree'
  return 'directory'
}

async function resolveRepoRoot(
  envName: string,
  fallbacks: string[]
): Promise<string | null> {
  const explicit = process.env[envName]
  if (explicit) {
    try {
      const stats = await fs.stat(explicit)
      if (stats.isDirectory()) return explicit
    } catch {
      return null
    }
  }

  for (const fallback of fallbacks) {
    try {
      const stats = await fs.stat(fallback)
      if (stats.isDirectory()) return fallback
    } catch {
      continue
    }
  }

  return null
}

export async function resolveKickstartConfigRepoRoot(): Promise<string | null> {
  return resolveRepoRoot(CONFIG_REPO_ENV, [
    path.resolve(process.cwd(), '..', '..', 'config'),
  ])
}

export async function resolveKickstartContentRepoRoot(): Promise<string | null> {
  return resolveRepoRoot(CONTENT_REPO_ENV, [
    path.resolve(process.cwd(), '..', '..', 'kb'),
  ])
}

async function cloneRepoToTemp(
  root: string
): Promise<{ ok: true; dir: string } | { ok: false }> {
  const dir = await fs.mkdtemp(path.join(tmpdir(), 'arche-kickstart-'))
  const cloneResult = await runGit(['clone', '--quiet', root, dir])
  if (!cloneResult.ok) {
    await fs.rm(dir, { recursive: true, force: true }).catch(() => {})
    return { ok: false }
  }

  return { ok: true, dir }
}

async function detectDefaultBranch(repoDir: string): Promise<string> {
  const originHead = await runGit(
    ['symbolic-ref', '-q', '--short', 'refs/remotes/origin/HEAD'],
    { cwd: repoDir }
  )
  if (originHead.ok) {
    const ref = originHead.stdout.trim()
    if (ref.startsWith('origin/')) {
      return ref.slice('origin/'.length)
    }
  }

  const hasMain = await runGit(
    ['show-ref', '--verify', '--quiet', 'refs/remotes/origin/main'],
    { cwd: repoDir }
  )
  if (hasMain.ok) return 'main'

  const hasMaster = await runGit(
    ['show-ref', '--verify', '--quiet', 'refs/remotes/origin/master'],
    { cwd: repoDir }
  )
  if (hasMaster.ok) return 'master'

  return 'main'
}

async function ensureBranch(repoDir: string, branch: string): Promise<boolean> {
  const checkout = await runGit(['checkout', branch], { cwd: repoDir })
  if (checkout.ok) return true

  const create = await runGit(['checkout', '-b', branch], { cwd: repoDir })
  return create.ok
}

async function withBareRepoCheckout<T>(
  root: string,
  operation: (args: { dir: string; branch: string }) => Promise<T>
): Promise<{ ok: true; value: T } | { ok: false; error: 'write_failed' }> {
  if (!(await isGitAvailable())) {
    return { ok: false, error: 'write_failed' }
  }

  const clone = await cloneRepoToTemp(root)
  if (!clone.ok) {
    return { ok: false, error: 'write_failed' }
  }

  try {
    const branch = await detectDefaultBranch(clone.dir)
    const ready = await ensureBranch(clone.dir, branch)
    if (!ready) {
      return { ok: false, error: 'write_failed' }
    }

    const value = await operation({ dir: clone.dir, branch })
    return { ok: true, value }
  } finally {
    await fs.rm(clone.dir, { recursive: true, force: true }).catch(() => {})
  }
}

async function commitAndPush(
  repoDir: string,
  branch: string,
  commitMessage: string
): Promise<CommitPushResult> {
  const add = await runGit(['add', '-A'], { cwd: repoDir })
  if (!add.ok) {
    return { ok: false, error: 'write_failed' }
  }

  const status = await runGit(['status', '--porcelain'], { cwd: repoDir })
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
    { cwd: repoDir }
  )
  if (!commit.ok) {
    return { ok: false, error: 'write_failed' }
  }

  const push = await runGit(['push', 'origin', `HEAD:refs/heads/${branch}`], {
    cwd: repoDir,
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

async function worktreePathsExist(
  root: string,
  requiredPaths: KickstartRepoPathRequirement[]
): Promise<boolean> {
  for (const requiredPath of requiredPaths) {
    const safePath = normalizeRepoPath(requiredPath.path)
    if (!safePath) return false

    try {
      const stats = await fs.stat(path.join(root, safePath))
      const validType = requiredPath.type === 'file' ? stats.isFile() : stats.isDirectory()
      if (!validType) {
        return false
      }
    } catch {
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

  const mode = await detectRepoMode(root)
  if (mode === 'bare') {
    return bareRepoPathsExist(root, requiredPaths)
  }

  return worktreePathsExist(root, requiredPaths)
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

  const mode = await detectRepoMode(root)
  if (mode !== 'bare') {
    try {
      if (await textFilesMatch(root, files)) {
        return { ok: true }
      }

      const written = await writeTextFiles(root, files)
      if (!written) {
        return { ok: false, error: 'write_failed' }
      }
      return { ok: true }
    } catch {
      return { ok: false, error: 'write_failed' }
    }
  }

  const result = await withBareRepoCheckout(root, async ({ dir, branch }) => {
    if (await textFilesMatch(dir, files)) {
      return { ok: true as const }
    }

    const written = await writeTextFiles(dir, files)
    if (!written) {
      return { ok: false as const, error: 'write_failed' as const }
    }

    return commitAndPush(dir, branch, 'Apply kickstart config')
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

  const mode = await detectRepoMode(root)
  if (mode !== 'bare') {
    try {
      if (await contentTreeMatches(root, args.directories, args.files)) {
        return { ok: true }
      }

      await clearDirectoryExceptGit(root)
      const written = await writeContentTree(root, args.directories, args.files)
      if (!written) {
        return { ok: false, error: 'write_failed' }
      }
      return { ok: true }
    } catch {
      return { ok: false, error: 'write_failed' }
    }
  }

  const result = await withBareRepoCheckout(root, async ({ dir, branch }) => {
    if (await contentTreeMatches(dir, args.directories, args.files)) {
      return { ok: true as const }
    }

    await clearDirectoryExceptGit(dir)
    const written = await writeContentTree(dir, args.directories, args.files)
    if (!written) {
      return { ok: false as const, error: 'write_failed' as const }
    }

    return commitAndPush(dir, branch, 'Apply kickstart KB template')
  })

  if (!result.ok) {
    return { ok: false, error: 'write_failed' }
  }

  if (!result.value.ok) {
    return { ok: false, error: result.value.error }
  }

  return { ok: true }
}

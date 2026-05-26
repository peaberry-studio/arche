import { createHash } from 'node:crypto'
import * as fs from 'node:fs/promises'
import * as path from 'node:path'

export type GitResult =
  | { ok: true; stdout: string }
  | { ok: false; stderr: string }

export type CloneResult =
  | { ok: true; dir: string; gitEnv: NodeJS.ProcessEnv; safeConfigDir: string }
  | { ok: false }

type BareRepoMutationContext = {
  currentHash: string | null
  gitEnv: NodeJS.ProcessEnv
  repoDir: string
}

type BareRepoMutationSuccess<T> = {
  changedPaths: string[]
  data: T
  ok: true
}

type BareRepoMutationError = 'clone_failed' | 'conflict' | 'git_unavailable' | 'repo_unavailable' | 'write_failed'

type MutateBareRepoArgs<T, E extends string> = {
  commitMessage: string
  expectedHash?: string
  gitAuthorEmail: string
  gitAuthorName: string
  mutate: (context: BareRepoMutationContext) => Promise<BareRepoMutationSuccess<T> | { ok: false; error: E }>
  normalizeChangedPath?: (input: string) => string
  root: string
}

export type BareRepoMutationResult<T, E extends string = never> =
  | { ok: true; data: T; hash: string | null }
  | { ok: false; error: BareRepoMutationError | E }

function importRuntimeModule<T>(specifier: string): Promise<T> {
  if (process.env.VITEST) {
    return import(specifier) as Promise<T>
  }

  return Function('runtimeSpecifier', 'return import(runtimeSpecifier)')(specifier) as Promise<T>
}

async function getExecFileAsync() {
  const { execFile } = await importRuntimeModule<typeof import('child_process')>('child_process')
  const { promisify } = await importRuntimeModule<typeof import('util')>('util')
  return promisify(execFile)
}

let gitAvailabilityCache: boolean | null = null

export async function runGit(
  args: string[],
  options?: { cwd?: string; env?: NodeJS.ProcessEnv }
): Promise<GitResult> {
  try {
    const execFileAsync = await getExecFileAsync()
    const result = await execFileAsync('git', args, {
      cwd: options?.cwd,
      encoding: 'utf-8',
      env: options?.env ? { ...process.env, ...options.env } : process.env,
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

export async function isGitAvailable(): Promise<boolean> {
  if (gitAvailabilityCache !== null) return gitAvailabilityCache
  const result = await runGit(['--version'])
  gitAvailabilityCache = result.ok
  return gitAvailabilityCache
}

export async function hasBareRepoLayout(root: string): Promise<boolean> {
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

export async function resolveRepoRoot(root: string): Promise<string | null> {
  try {
    const stats = await fs.stat(root)
    return stats.isDirectory() ? root : null
  } catch {
    return null
  }
}

export async function runGitOnBareRepo(
  root: string,
  args: string[]
): Promise<GitResult> {
  if (!(await hasBareRepoLayout(root))) {
    return { ok: false, stderr: 'not_bare_repository' }
  }

  if (!(await isGitAvailable())) {
    return { ok: false, stderr: 'git_unavailable' }
  }

  return runGit(['--git-dir', root, ...args])
}

export async function cloneRepoToTemp(root: string): Promise<CloneResult> {
  const { tmpdir } = await importRuntimeModule<typeof import('os')>('os')
  const dir = await fs.mkdtemp(path.join(tmpdir(), 'arche-kb-'))
  const safeConfigDir = await fs.mkdtemp(path.join(tmpdir(), 'arche-kb-safe-'))
  const safeConfig = path.join(safeConfigDir, 'gitconfig')
  const resolvedRoot = await fs.realpath(root).catch(() => root)
  const safeDirectories = Array.from(new Set([root, resolvedRoot]))
  const safeConfigContent = safeDirectories
    .map((safeDirectory) => `[safe]\n\tdirectory = ${safeDirectory}\n`)
    .join('')
  await fs.writeFile(safeConfig, safeConfigContent, 'utf-8')

  const gitEnv: NodeJS.ProcessEnv = {
    ...process.env,
    GIT_CONFIG_GLOBAL: safeConfig,
  }
  const clone = await runGit(['clone', '--quiet', root, dir], { env: gitEnv })
  if (!clone.ok) {
    await fs.rm(dir, { recursive: true, force: true }).catch(() => {})
    await fs.rm(safeConfigDir, { recursive: true, force: true }).catch(() => {})
    return { ok: false }
  }
  return { ok: true, dir, gitEnv, safeConfigDir }
}

export async function cleanupClone(clone: { dir: string; safeConfigDir: string }): Promise<void> {
  await fs.rm(clone.dir, { recursive: true, force: true }).catch(() => {})
  await fs.rm(clone.safeConfigDir, { recursive: true, force: true }).catch(() => {})
}

export async function detectDefaultBranch(
  repoDir: string,
  gitEnv: NodeJS.ProcessEnv
): Promise<string> {
  const originHead = await runGit(
    ['symbolic-ref', '-q', '--short', 'refs/remotes/origin/HEAD'],
    { cwd: repoDir, env: gitEnv }
  )
  if (originHead.ok) {
    const ref = originHead.stdout.trim()
    if (ref.startsWith('origin/')) {
      return ref.slice('origin/'.length)
    }
  }

  const hasMain = await runGit(
    ['show-ref', '--verify', '--quiet', 'refs/remotes/origin/main'],
    { cwd: repoDir, env: gitEnv }
  )
  if (hasMain.ok) return 'main'

  const hasMaster = await runGit(
    ['show-ref', '--verify', '--quiet', 'refs/remotes/origin/master'],
    { cwd: repoDir, env: gitEnv }
  )
  if (hasMaster.ok) return 'master'

  return 'main'
}

export async function getRepoHeadHash(repoDir: string, gitEnv: NodeJS.ProcessEnv): Promise<string | null> {
  const head = await runGit(['rev-parse', 'HEAD'], { cwd: repoDir, env: gitEnv })
  if (!head.ok) return null

  const hash = head.stdout.trim()
  return hash.length > 0 ? hash : null
}

export async function mutateBareRepo<T, E extends string = never>({
  commitMessage,
  expectedHash,
  gitAuthorEmail,
  gitAuthorName,
  mutate,
  normalizeChangedPath = normalizeRepoRelativePath,
  root,
}: MutateBareRepoArgs<T, E>): Promise<BareRepoMutationResult<T, E>> {
  if (!(await hasBareRepoLayout(root))) {
    return { ok: false, error: 'repo_unavailable' }
  }

  if (!(await isGitAvailable())) {
    return { ok: false, error: 'git_unavailable' }
  }

  const clone = await cloneRepoToTemp(root)
  if (!clone.ok) {
    return { ok: false, error: 'clone_failed' }
  }

  try {
    const currentHash = await getRepoHeadHash(clone.dir, clone.gitEnv)
    if (expectedHash && currentHash && expectedHash !== currentHash) {
      return { ok: false, error: 'conflict' }
    }

    const mutation = await mutate({ currentHash, repoDir: clone.dir, gitEnv: clone.gitEnv })
    if (!mutation.ok) return mutation

    const changedPaths = Array.from(new Set(mutation.changedPaths.map(normalizeChangedPath)))
    if (changedPaths.length === 0) {
      return { ok: true, data: mutation.data, hash: currentHash }
    }

    const add = await runGit(['add', '-A', '--', ...changedPaths], {
      cwd: clone.dir,
      env: clone.gitEnv,
    })
    if (!add.ok) return { ok: false, error: 'write_failed' }

    const status = await runGit(['status', '--porcelain', '--', ...changedPaths], {
      cwd: clone.dir,
      env: clone.gitEnv,
    })
    if (!status.ok) return { ok: false, error: 'write_failed' }
    if (!status.stdout.trim()) {
      return { ok: true, data: mutation.data, hash: currentHash }
    }

    const commit = await runGit(
      [
        '-c', `user.name=${gitAuthorName}`,
        '-c', `user.email=${gitAuthorEmail}`,
        'commit',
        '-m', commitMessage,
      ],
      { cwd: clone.dir, env: clone.gitEnv }
    )
    if (!commit.ok) return { ok: false, error: 'write_failed' }

    const branch = await detectDefaultBranch(clone.dir, clone.gitEnv)
    const push = await runGit(['push', 'origin', `HEAD:refs/heads/${branch}`], {
      cwd: clone.dir,
      env: clone.gitEnv,
    })
    if (!push.ok) {
      return { ok: false, error: isNonFastForward(push.stderr) ? 'conflict' : 'write_failed' }
    }

    return { ok: true, data: mutation.data, hash: await getRepoHeadHash(clone.dir, clone.gitEnv) }
  } finally {
    await cleanupClone(clone)
  }
}

export function normalizeRepoRelativePath(input: string): string {
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

export function hashContent(content: string): string {
  return createHash('sha256').update(content).digest('hex')
}

function isNonFastForward(stderr: string): boolean {
  return stderr.includes('non-fast-forward')
}

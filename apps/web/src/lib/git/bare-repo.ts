import { createHash } from 'node:crypto'
import * as fs from 'node:fs/promises'
import * as path from 'node:path'

export type GitResult =
  | { ok: true; stdout: string }
  | { ok: false; stderr: string }

export type CloneResult =
  | { ok: true; dir: string; gitEnv: NodeJS.ProcessEnv; safeConfigDir: string }
  | { ok: false }

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

export function hashContent(content: string): string {
  return createHash('sha256').update(content).digest('hex')
}

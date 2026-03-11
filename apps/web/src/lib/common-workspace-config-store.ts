import { promises as fs } from 'fs'
import path from 'path'

import {
  cleanupClone,
  cloneRepoToTemp,
  detectDefaultBranch,
  hasBareRepoLayout,
  hashContent,
  isGitAvailable,
  resolveRepoRoot,
  runGit,
  runGitOnBareRepo,
} from '@/lib/git/bare-repo'

type ConfigReadResult =
  | { ok: true; content: string; hash: string; path: string }
  | { ok: false; error: 'not_found' | 'kb_unavailable' | 'read_failed' }

type ConfigWriteResult =
  | { ok: true; hash: string }
  | { ok: false; error: 'conflict' | 'kb_unavailable' | 'write_failed' }

export type KbRecentFileUpdate = {
  filePath: string
  fileName: string
  author: string
  committedAt: string
}

const CONFIG_REPO_ROOT = '/kb-config'
const CONTENT_REPO_ROOT = '/kb-content'
const CONFIG_FILE_NAME = 'CommonWorkspaceConfig.json'

async function resolveConfigRepoRoot(): Promise<string | null> {
  return resolveRepoRoot(CONFIG_REPO_ROOT)
}

async function resolveContentRepoRoot(): Promise<string | null> {
  return resolveRepoRoot(CONTENT_REPO_ROOT)
}

export async function readCommonWorkspaceConfig(): Promise<ConfigReadResult> {
  const root = await resolveConfigRepoRoot()
  if (!root) return { ok: false, error: 'kb_unavailable' }

  if (!(await hasBareRepoLayout(root))) {
    return { ok: false, error: 'kb_unavailable' }
  }

  if (!(await isGitAvailable())) {
    return { ok: false, error: 'read_failed' }
  }

  const clone = await cloneRepoToTemp(root)
  if (!clone.ok) return { ok: false, error: 'read_failed' }

  const configPath = path.join(clone.dir, CONFIG_FILE_NAME)

  try {
    const content = await fs.readFile(configPath, 'utf-8')
    return { ok: true, content, hash: hashContent(content), path: `${root}#${CONFIG_FILE_NAME}` }
  } catch (error) {
    if (error && typeof error === 'object' && 'code' in error && error.code === 'ENOENT') {
      return { ok: false, error: 'not_found' }
    }
    return { ok: false, error: 'read_failed' }
  } finally {
    await cleanupClone(clone)
  }
}

export async function writeCommonWorkspaceConfig(
  content: string,
  expectedHash?: string
): Promise<ConfigWriteResult> {
  const root = await resolveConfigRepoRoot()
  if (!root) return { ok: false, error: 'kb_unavailable' }

  if (!(await hasBareRepoLayout(root))) {
    return { ok: false, error: 'kb_unavailable' }
  }

  if (!(await isGitAvailable())) {
    return { ok: false, error: 'write_failed' }
  }

  const clone = await cloneRepoToTemp(root)
  if (!clone.ok) return { ok: false, error: 'write_failed' }

  const configPath = path.join(clone.dir, CONFIG_FILE_NAME)
  const current = await fs.readFile(configPath, 'utf-8').catch(() => '')
  if (expectedHash && current && hashContent(current) !== expectedHash) {
    await cleanupClone(clone)
    return { ok: false, error: 'conflict' }
  }

  try {
    await fs.mkdir(path.dirname(configPath), { recursive: true })
    await fs.writeFile(configPath, content, 'utf-8')

    const add = await runGit(['add', CONFIG_FILE_NAME], { cwd: clone.dir, env: clone.gitEnv })
    if (!add.ok) {
      return { ok: false, error: 'write_failed' }
    }

    const status = await runGit(['status', '--porcelain', '--', CONFIG_FILE_NAME], {
      cwd: clone.dir,
      env: clone.gitEnv,
    })
    if (!status.ok) {
      return { ok: false, error: 'write_failed' }
    }

    if (!status.stdout.trim()) {
      return { ok: true, hash: hashContent(content) }
    }

    const commit = await runGit(
      [
        '-c', 'user.name=Arche Config',
        '-c', 'user.email=config@arche.local',
        'commit',
        '-m', 'Update common workspace config'
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

    return { ok: true, hash: hashContent(content) }
  } finally {
    await cleanupClone(clone)
  }
}

export async function listRecentKbFileUpdates(limit = 10): Promise<{
  ok: true
  updates: KbRecentFileUpdate[]
} | {
  ok: false
  error: 'kb_unavailable' | 'read_failed'
}> {
  const root = await resolveContentRepoRoot()
  if (!root) return { ok: false, error: 'kb_unavailable' }

  const logResult = await runGitOnBareRepo(root, [
    'log',
    '--name-only',
    '--date=iso-strict',
    "--pretty=format:__COMMIT__%an|%ad"
  ])

  if (!logResult.ok) {
    return { ok: false, error: 'read_failed' }
  }

  const updates: KbRecentFileUpdate[] = []
  const seen = new Set<string>()
  let currentAuthor = 'Unknown'
  let currentDate = ''

  for (const line of logResult.stdout.split('\n')) {
    if (line.startsWith('__COMMIT__')) {
      const payload = line.slice('__COMMIT__'.length)
      const separatorIndex = payload.indexOf('|')
      if (separatorIndex >= 0) {
        currentAuthor = payload.slice(0, separatorIndex) || 'Unknown'
        currentDate = payload.slice(separatorIndex + 1) || ''
      }
      continue
    }

    const filePath = line.trim()
    if (!filePath || seen.has(filePath)) continue

    seen.add(filePath)
    updates.push({
      filePath,
      fileName: path.basename(filePath),
      author: currentAuthor,
      committedAt: currentDate
    })

    if (updates.length >= limit) break
  }

  return { ok: true, updates }
}

export async function readConfigRepoFile(
  fileName: string
): Promise<{ ok: true; content: string } | { ok: false }> {
  const root = await resolveConfigRepoRoot()
  if (!root) return { ok: false }

  if (!(await hasBareRepoLayout(root))) {
    return { ok: false }
  }

  if (!(await isGitAvailable())) return { ok: false }

  const clone = await cloneRepoToTemp(root)
  if (!clone.ok) return { ok: false }

  try {
    const content = await fs.readFile(path.join(clone.dir, fileName), 'utf-8')
    return { ok: true, content }
  } catch {
    return { ok: false }
  } finally {
    await cleanupClone(clone)
  }
}

export async function getCommonWorkspaceConfigHash(): Promise<
  | { ok: true; hash: string }
  | { ok: false; error: 'not_found' | 'kb_unavailable' | 'read_failed' }
> {
  const result = await readCommonWorkspaceConfig()
  if (!result.ok) return result
  return { ok: true, hash: result.hash }
}

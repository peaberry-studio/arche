import * as fs from 'node:fs/promises'
import * as path from 'node:path'

import { getInstallationToken } from '@/lib/git/github-app-auth'
import { getKbContentRoot, getKbSyncWorkingCopyRoot } from '@/lib/runtime/paths'

import {
  addOrUpdateRemote,
  hasBareRepoLayout,
  hasRemote,
  isGitAvailable,
  removeRemote,
  runGit,
} from './bare-repo'

export type KbGithubPushResult =
  | { ok: true; status: 'pushed'; commitHash: string; branch: string }
  | { ok: true; status: 'up_to_date'; branch: string }
  | { ok: false; status: 'not_configured' | 'kb_unavailable' | 'auth_failed' | 'push_rejected' | 'error'; message: string; detail?: string }

export type KbGithubPullResult =
  | { ok: true; status: 'pulled'; commitHash: string; branch: string }
  | { ok: true; status: 'up_to_date'; branch: string }
  | { ok: false; status: 'not_configured' | 'kb_unavailable' | 'auth_failed' | 'conflicts' | 'error'; message: string; detail?: string; conflictingFiles?: string[] }

export type KbGithubSyncCredentials = {
  appId: string
  privateKey: string
  installationId: number
  repoCloneUrl: string
}

export type ConflictDetail = {
  path: string
  ours: string
  theirs: string
  base: string
  working: string
}

const GITHUB_REMOTE = 'github'

const HUMAN_ERRORS = {
  auth_failed: 'GitHub authentication failed. Check your GitHub App credentials and installation.',
  push_rejected: 'Push rejected — the remote has newer changes. Pull from GitHub first.',
  fetch_error: 'Failed to fetch from GitHub. Check your network connection and repository access.',
  merge_failed: 'Merge failed due to incompatible changes.',
  update_kb_failed: 'Merged successfully but failed to update the knowledge base.',
  generic: 'An unexpected error occurred during GitHub sync.',
}

function getRemoteBranchRef(branch: string): string {
  return `refs/remotes/${GITHUB_REMOTE}/${branch}`
}

function getRemoteFetchRefSpec(branch: string): string {
  return `+refs/heads/${branch}:${getRemoteBranchRef(branch)}`
}

function normalizeConflictFilePath(filePath: string): string | null {
  const trimmed = filePath.trim()
  if (!trimmed || trimmed.includes('\0') || path.isAbsolute(trimmed)) {
    return null
  }

  const normalized = path.posix.normalize(trimmed.replaceAll('\\', '/'))
  if (normalized === '.' || normalized === '..' || normalized.startsWith('../')) {
    return null
  }

  return normalized
}

function resolveSyncWcFilePath(wcPath: string, filePath: string): string {
  const absolutePath = path.resolve(wcPath, filePath)
  const relativePath = path.relative(wcPath, absolutePath)

  if (relativePath.startsWith('..') || path.isAbsolute(relativePath)) {
    throw new Error('Invalid conflict path')
  }

  return absolutePath
}

export function buildAuthenticatedUrl(repoCloneUrl: string, token: string): string {
  try {
    const url = new URL(repoCloneUrl)
    url.username = 'x-access-token'
    url.password = token
    return url.toString()
  } catch {
    return repoCloneUrl
  }
}

export function sanitizeGitError(stderr: string, token: string): string {
  if (!token) return stderr
  return stderr.replaceAll(token, '***')
}

function isAuthFailure(stderr: string): boolean {
  const lower = stderr.toLowerCase()
  return (
    lower.includes('authentication failed') ||
    lower.includes('could not read username') ||
    lower.includes('invalid credentials') ||
    lower.includes('403') ||
    lower.includes('401') ||
    lower.includes('permission denied')
  )
}

async function acquireToken(
  creds: KbGithubSyncCredentials,
): Promise<{ ok: true; token: string } | { ok: false; status: 'auth_failed' | 'error'; message: string }> {
  const result = await getInstallationToken(creds.appId, creds.privateKey, creds.installationId)
  if (!result.ok) {
    return {
      ok: false,
      status: result.status === 'auth_failed' ? 'auth_failed' : 'error',
      message: result.message,
    }
  }
  return { ok: true, token: result.token }
}

async function requireBareRepo(): Promise<
  | { ok: true; bareRepoPath: string }
  | { ok: false; result: { ok: false; status: 'kb_unavailable'; message: string } }
> {
  const bareRepoPath = getKbContentRoot()

  if (!await isGitAvailable()) {
    return { ok: false, result: { ok: false, status: 'kb_unavailable', message: 'Git is not available' } }
  }
  if (!await hasBareRepoLayout(bareRepoPath)) {
    return { ok: false, result: { ok: false, status: 'kb_unavailable', message: 'KB content repository not found' } }
  }

  return { ok: true, bareRepoPath }
}

async function detectBareRepoBranch(bareRepoPath: string): Promise<string> {
  const head = await runGit(['--git-dir', bareRepoPath, 'symbolic-ref', '--short', 'HEAD'])
  if (head.ok) {
    const branch = head.stdout.trim()
    if (branch) return branch
  }

  const hasMain = await runGit(['--git-dir', bareRepoPath, 'show-ref', '--verify', '--quiet', 'refs/heads/main'])
  if (hasMain.ok) return 'main'

  const hasMaster = await runGit(['--git-dir', bareRepoPath, 'show-ref', '--verify', '--quiet', 'refs/heads/master'])
  if (hasMaster.ok) return 'master'

  return 'main'
}

async function withAuthenticatedRemote<T>(
  creds: KbGithubSyncCredentials,
  gitDir: string,
  fn: (token: string) => Promise<T>,
): Promise<
  | { ok: true; value: T; token: string }
  | { ok: false; status: 'auth_failed' | 'error'; message: string; detail?: string }
> {
  const tokenResult = await acquireToken(creds)
  if (!tokenResult.ok) return { ok: false, status: tokenResult.status, message: tokenResult.message }

  const { token } = tokenResult
  const authenticatedUrl = buildAuthenticatedUrl(creds.repoCloneUrl, token)

  await addOrUpdateRemote(gitDir, GITHUB_REMOTE, authenticatedUrl)
  try {
    const value = await fn(token)
    return { ok: true, value, token }
  } finally {
    await addOrUpdateRemote(gitDir, GITHUB_REMOTE, creds.repoCloneUrl).catch(() => {})
  }
}

// --- Public API: Remote Management ---

export async function ensureGithubRemote(repoCloneUrl: string): Promise<void> {
  const bareRepoPath = getKbContentRoot()
  await addOrUpdateRemote(bareRepoPath, GITHUB_REMOTE, repoCloneUrl)
}

export async function removeGithubRemote(): Promise<void> {
  const bareRepoPath = getKbContentRoot()
  if (await hasRemote(bareRepoPath, GITHUB_REMOTE)) {
    await removeRemote(bareRepoPath, GITHUB_REMOTE)
  }
}

// --- Public API: Push ---

export async function pushToGithub(creds: KbGithubSyncCredentials): Promise<KbGithubPushResult> {
  const req = await requireBareRepo()
  if (!req.ok) return req.result

  const { bareRepoPath } = req
  const branch = await detectBareRepoBranch(bareRepoPath)

  try {
    const authResult = await withAuthenticatedRemote(creds, bareRepoPath, async (token) => {
      const push = await runGit([
        '--git-dir', bareRepoPath,
        'push', GITHUB_REMOTE, `refs/heads/${branch}:refs/heads/${branch}`,
      ])

      if (!push.ok) {
        const detail = sanitizeGitError(push.stderr, token)
        if (isAuthFailure(push.stderr)) {
          return { ok: false as const, status: 'auth_failed' as const, message: HUMAN_ERRORS.auth_failed, detail }
        }
        if (push.stderr.includes('non-fast-forward') || push.stderr.includes('rejected')) {
          return { ok: false as const, status: 'push_rejected' as const, message: HUMAN_ERRORS.push_rejected, detail }
        }
        return { ok: false as const, status: 'error' as const, message: HUMAN_ERRORS.generic, detail }
      }

      if (push.stderr.includes('Everything up-to-date')) {
        return { ok: true as const, status: 'up_to_date' as const, branch }
      }

      const head = await runGit(['--git-dir', bareRepoPath, 'rev-parse', `refs/heads/${branch}`])
      const commitHash = head.ok ? head.stdout.trim() : 'unknown'

      return { ok: true as const, status: 'pushed' as const, commitHash, branch }
    })

    if (!authResult.ok) {
      return { ok: false, status: authResult.status, message: authResult.message, detail: authResult.detail }
    }

    return authResult.value
  } catch (error) {
    return { ok: false, status: 'error', message: HUMAN_ERRORS.generic, detail: error instanceof Error ? error.message : undefined }
  }
}

// --- Public API: Pull ---

export async function pullFromGithub(creds: KbGithubSyncCredentials): Promise<KbGithubPullResult> {
  const req = await requireBareRepo()
  if (!req.ok) return req.result

  if (await hasPendingSyncConflicts()) {
    const conflictingFiles = await listSyncConflicts()
    return {
      ok: false,
      status: 'conflicts',
      message: `Merge conflicts in ${conflictingFiles.length} file(s)`,
      conflictingFiles,
    }
  }

  const { bareRepoPath } = req
  const branch = await detectBareRepoBranch(bareRepoPath)

  try {
    const authResult = await withAuthenticatedRemote(creds, bareRepoPath, async (token) => {
      // Fetch from GitHub into bare repo
      const fetchResult = await runGit([
        '--git-dir', bareRepoPath,
        'fetch', GITHUB_REMOTE, getRemoteFetchRefSpec(branch),
      ])
      if (!fetchResult.ok) {
        const detail = sanitizeGitError(fetchResult.stderr, token)
        if (isAuthFailure(fetchResult.stderr)) {
          return { ok: false as const, status: 'auth_failed' as const, message: HUMAN_ERRORS.auth_failed, detail }
        }
        return { ok: false as const, status: 'error' as const, message: HUMAN_ERRORS.fetch_error, detail }
      }

      // Check if there's anything new
      const localRef = `refs/heads/${branch}`
      const remoteRef = getRemoteBranchRef(branch)

      // Check if local is ancestor of remote (fast-forward possible)
      const isLocalAncestor = await runGit([
        '--git-dir', bareRepoPath,
        'merge-base', '--is-ancestor', localRef, remoteRef,
      ])

      if (isLocalAncestor.ok) {
        // Check if they're the same commit (already up to date)
        const localHash = await runGit(['--git-dir', bareRepoPath, 'rev-parse', localRef])
        const remoteHash = await runGit(['--git-dir', bareRepoPath, 'rev-parse', remoteRef])
        if (localHash.ok && remoteHash.ok && localHash.stdout.trim() === remoteHash.stdout.trim()) {
          return { ok: true as const, status: 'up_to_date' as const, branch }
        }

        // Fast-forward: update the ref directly
        const update = await runGit([
          '--git-dir', bareRepoPath,
          'update-ref', localRef, remoteRef,
        ])
        if (!update.ok) {
          return { ok: false as const, status: 'error' as const, message: HUMAN_ERRORS.generic, detail: update.stderr }
        }

        const head = await runGit(['--git-dir', bareRepoPath, 'rev-parse', localRef])
        return { ok: true as const, status: 'pulled' as const, commitHash: head.ok ? head.stdout.trim() : 'unknown', branch }
      }

      // Check if remote is ancestor of local (we're ahead, nothing to pull)
      const isRemoteAncestor = await runGit([
        '--git-dir', bareRepoPath,
        'merge-base', '--is-ancestor', remoteRef, localRef,
      ])
      if (isRemoteAncestor.ok) {
        return { ok: true as const, status: 'up_to_date' as const, branch }
      }

      // Diverged — need merge in sync working copy
      return mergeInSyncWorkingCopy(bareRepoPath, branch, creds.repoCloneUrl, token)
    })

    if (!authResult.ok) {
      return { ok: false, status: authResult.status, message: authResult.message, detail: authResult.detail }
    }

    return authResult.value
  } catch (error) {
    return { ok: false, status: 'error', message: HUMAN_ERRORS.generic, detail: error instanceof Error ? error.message : undefined }
  }
}

// --- Sync Working Copy (for merges only) ---

async function getSyncWcPath(): Promise<string> {
  return getKbSyncWorkingCopyRoot()
}

async function syncWcExists(): Promise<boolean> {
  const wcPath = await getSyncWcPath()
  try {
    const stat = await fs.stat(wcPath)
    return stat.isDirectory()
  } catch {
    return false
  }
}

async function ensureSyncWc(bareRepoPath: string, branch: string): Promise<string> {
  const wcPath = await getSyncWcPath()

  if (await syncWcExists()) {
    await runGit(['fetch', 'origin'], { cwd: wcPath })
    await runGit(['checkout', branch], { cwd: wcPath })
    await runGit(['reset', '--hard', `origin/${branch}`], { cwd: wcPath })
  } else {
    const clone = await runGit(['clone', bareRepoPath, wcPath])
    if (!clone.ok) {
      throw new Error(`Failed to create sync working copy: ${clone.stderr}`)
    }
    const checkout = await runGit(['checkout', branch], { cwd: wcPath })
    if (!checkout.ok) {
      const createBranch = await runGit(['checkout', '-b', branch], { cwd: wcPath })
      if (!createBranch.ok) {
        throw new Error(`Failed to checkout branch ${branch}: ${createBranch.stderr}`)
      }
    }
  }

  return wcPath
}

async function mergeInSyncWorkingCopy(
  bareRepoPath: string,
  branch: string,
  repoCloneUrl: string,
  token: string,
): Promise<KbGithubPullResult> {
  const wcPath = await ensureSyncWc(bareRepoPath, branch)

  // Add/update github remote on the working copy
  const authenticatedUrl = buildAuthenticatedUrl(repoCloneUrl, token)
  await addOrUpdateRemote(`${wcPath}/.git`, GITHUB_REMOTE, authenticatedUrl)

  try {
    // Fetch from GitHub in the working copy
    await runGit(['fetch', GITHUB_REMOTE, getRemoteFetchRefSpec(branch)], { cwd: wcPath })

    // Attempt merge
    const merge = await runGit(['merge', `${GITHUB_REMOTE}/${branch}`, '--no-edit'], { cwd: wcPath })

    if (!merge.ok) {
      const mergeOutput = `${merge.stdout}\n${merge.stderr}`.toLowerCase()
      if (!mergeOutput.includes('conflict')) {
        await runGit(['merge', '--abort'], { cwd: wcPath })
        return { ok: false, status: 'error', message: HUMAN_ERRORS.merge_failed, detail: sanitizeGitError(merge.stderr, token) }
      }

      // Conflicts — leave merge in progress for resolution
      const conflictFiles = await runGit(['diff', '--name-only', '--diff-filter=U'], { cwd: wcPath })
      const files = conflictFiles.ok
        ? conflictFiles.stdout.trim().split('\n').filter(Boolean)
        : []

      return {
        ok: false,
        status: 'conflicts',
        message: `Merge conflicts in ${files.length} file(s)`,
        conflictingFiles: files,
      }
    }

    // Merge succeeded — push result back to bare repo
    const pushBack = await runGit(['push', 'origin', `HEAD:refs/heads/${branch}`], { cwd: wcPath })
    if (!pushBack.ok) {
      return { ok: false, status: 'error', message: HUMAN_ERRORS.update_kb_failed, detail: pushBack.stderr }
    }

    const head = await runGit(['rev-parse', 'HEAD'], { cwd: wcPath })
    return { ok: true, status: 'pulled', commitHash: head.ok ? head.stdout.trim() : 'unknown', branch }
  } finally {
    // Clear token from working copy remote URL
    await addOrUpdateRemote(`${wcPath}/.git`, GITHUB_REMOTE, repoCloneUrl).catch(() => {})
  }
}

// --- Public API: Conflict Management ---

export async function hasPendingSyncConflicts(): Promise<boolean> {
  if (!await syncWcExists()) return false
  const wcPath = await getSyncWcPath()

  const mergeHead = await runGit(['rev-parse', '--verify', 'MERGE_HEAD'], { cwd: wcPath })
  return mergeHead.ok
}

export async function listSyncConflicts(): Promise<string[]> {
  if (!await syncWcExists()) return []
  const wcPath = await getSyncWcPath()

  const result = await runGit(['diff', '--name-only', '--diff-filter=U'], { cwd: wcPath })
  if (!result.ok) return []
  return result.stdout.trim().split('\n').map(normalizeConflictFilePath).filter((filePath): filePath is string => Boolean(filePath))
}

export async function getSyncConflictDetail(filePath: string): Promise<ConflictDetail | null> {
  if (!await syncWcExists()) return null
  const wcPath = await getSyncWcPath()
  const normalizedPath = normalizeConflictFilePath(filePath)
  if (!normalizedPath) return null
  const resolvedFilePath = resolveSyncWcFilePath(wcPath, normalizedPath)

  const [oursResult, theirsResult, baseResult, workingResult] = await Promise.all([
    runGit(['show', `:2:${normalizedPath}`], { cwd: wcPath }),
    runGit(['show', `:3:${normalizedPath}`], { cwd: wcPath }),
    runGit(['show', `:1:${normalizedPath}`], { cwd: wcPath }),
    fs.readFile(resolvedFilePath, 'utf-8').catch(() => ''),
  ])

  return {
    path: normalizedPath,
    ours: oursResult.ok ? oursResult.stdout : '',
    theirs: theirsResult.ok ? theirsResult.stdout : '',
    base: baseResult.ok ? baseResult.stdout : '',
    working: workingResult,
  }
}

export async function resolveSyncConflict(
  filePath: string,
  strategy: 'ours' | 'theirs',
  content?: string,
): Promise<void> {
  if (!await syncWcExists()) throw new Error('No sync working copy exists')
  const wcPath = await getSyncWcPath()
  const normalizedPath = normalizeConflictFilePath(filePath)
  if (!normalizedPath) throw new Error('Invalid conflict path')

  if (content !== undefined) {
    await fs.writeFile(resolveSyncWcFilePath(wcPath, normalizedPath), content, 'utf-8')
  } else {
    const flag = strategy === 'ours' ? '--ours' : '--theirs'
    const checkout = await runGit(['checkout', flag, '--', normalizedPath], { cwd: wcPath })
    if (!checkout.ok) throw new Error(`Failed to resolve conflict: ${checkout.stderr}`)
  }

  const add = await runGit(['add', '--', normalizedPath], { cwd: wcPath })
  if (!add.ok) throw new Error(`Failed to stage resolved file: ${add.stderr}`)
}

export async function finalizeSyncMerge(): Promise<{ ok: true; commitHash: string; branch: string } | { ok: false; message: string }> {
  if (!await syncWcExists()) return { ok: false, message: 'No sync working copy exists' }
  const wcPath = await getSyncWcPath()

  // Check no remaining conflicts
  const remaining = await listSyncConflicts()
  if (remaining.length > 0) {
    return { ok: false, message: `${remaining.length} unresolved conflict(s) remain` }
  }

  const commit = await runGit(['commit', '--no-edit'], { cwd: wcPath })
  if (!commit.ok) {
    return { ok: false, message: `Failed to commit merge: ${commit.stderr}` }
  }

  const branchResult = await runGit(['rev-parse', '--abbrev-ref', 'HEAD'], { cwd: wcPath })
  const branch = branchResult.ok ? branchResult.stdout.trim() : 'main'

  const pushBack = await runGit(['push', 'origin', `HEAD:refs/heads/${branch}`], { cwd: wcPath })
  if (!pushBack.ok) {
    return { ok: false, message: 'Committed merge but failed to update KB repository' }
  }

  const head = await runGit(['rev-parse', 'HEAD'], { cwd: wcPath })
  return { ok: true, commitHash: head.ok ? head.stdout.trim() : 'unknown', branch }
}

export async function abortSyncMerge(): Promise<void> {
  if (!await syncWcExists()) return
  const wcPath = await getSyncWcPath()

  await runGit(['merge', '--abort'], { cwd: wcPath })
  // Reset to origin state
  const branchResult = await runGit(['rev-parse', '--abbrev-ref', 'HEAD'], { cwd: wcPath })
  const branch = branchResult.ok ? branchResult.stdout.trim() : 'main'
  await runGit(['reset', '--hard', `origin/${branch}`], { cwd: wcPath })
}

import { getInstallationToken } from '@/lib/git/github-app-auth'
import { getKbContentRoot } from '@/lib/runtime/paths'

import {
  cloneRepoToTemp,
  cleanupClone,
  detectDefaultBranch,
  hasBareRepoLayout,
  isGitAvailable,
  runGit,
  type CloneResult,
} from './bare-repo'

export type KbGithubPushResult =
  | { ok: true; status: 'pushed'; commitHash: string }
  | { ok: true; status: 'up_to_date' }
  | { ok: false; status: 'not_configured' | 'kb_unavailable' | 'auth_failed' | 'push_rejected' | 'error'; message: string }

export type KbGithubPullResult =
  | { ok: true; status: 'pulled'; commitHash: string }
  | { ok: true; status: 'up_to_date' }
  | { ok: false; status: 'not_configured' | 'kb_unavailable' | 'auth_failed' | 'conflicts' | 'error'; message: string; conflictingFiles?: string[] }

export type KbGithubSyncCredentials = {
  appId: string
  privateKey: string
  installationId: number
  repoCloneUrl: string
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

export async function pushToGithub(creds: KbGithubSyncCredentials): Promise<KbGithubPushResult> {
  const kbContentRoot = getKbContentRoot()

  if (!await isGitAvailable()) {
    return { ok: false, status: 'kb_unavailable', message: 'Git is not available' }
  }
  if (!await hasBareRepoLayout(kbContentRoot)) {
    return { ok: false, status: 'kb_unavailable', message: 'KB content repository not found' }
  }

  const tokenResult = await acquireToken(creds)
  if (!tokenResult.ok) {
    return { ok: false, status: tokenResult.status, message: tokenResult.message }
  }
  const { token } = tokenResult

  let clone: CloneResult | null = null
  try {
    clone = await cloneRepoToTemp(kbContentRoot)
    if (!clone.ok) {
      return { ok: false, status: 'kb_unavailable', message: 'Failed to clone KB content repository' }
    }

    const authenticatedUrl = buildAuthenticatedUrl(creds.repoCloneUrl, token)

    const addRemote = await runGit(
      ['remote', 'add', 'github', authenticatedUrl],
      { cwd: clone.dir, env: clone.gitEnv },
    )
    if (!addRemote.ok) {
      return { ok: false, status: 'error', message: sanitizeGitError(addRemote.stderr, token) }
    }

    const branch = await detectDefaultBranch(clone.dir, clone.gitEnv)

    const push = await runGit(
      ['push', 'github', `HEAD:refs/heads/${branch}`],
      { cwd: clone.dir, env: clone.gitEnv },
    )

    if (!push.ok) {
      const sanitized = sanitizeGitError(push.stderr, token)
      if (isAuthFailure(push.stderr)) {
        return { ok: false, status: 'auth_failed', message: sanitized }
      }
      if (push.stderr.includes('non-fast-forward') || push.stderr.includes('rejected')) {
        return { ok: false, status: 'push_rejected', message: sanitized }
      }
      return { ok: false, status: 'error', message: sanitized }
    }

    const head = await runGit(['rev-parse', 'HEAD'], { cwd: clone.dir, env: clone.gitEnv })
    const commitHash = head.ok ? head.stdout.trim() : 'unknown'

    if (push.stderr.includes('Everything up-to-date')) {
      return { ok: true, status: 'up_to_date' }
    }

    return { ok: true, status: 'pushed', commitHash }
  } catch (error) {
    return { ok: false, status: 'error', message: error instanceof Error ? error.message : 'Unknown error' }
  } finally {
    if (clone && clone.ok) {
      await cleanupClone(clone)
    }
  }
}

export async function pullFromGithub(creds: KbGithubSyncCredentials): Promise<KbGithubPullResult> {
  const kbContentRoot = getKbContentRoot()

  if (!await isGitAvailable()) {
    return { ok: false, status: 'kb_unavailable', message: 'Git is not available' }
  }
  if (!await hasBareRepoLayout(kbContentRoot)) {
    return { ok: false, status: 'kb_unavailable', message: 'KB content repository not found' }
  }

  const tokenResult = await acquireToken(creds)
  if (!tokenResult.ok) {
    return { ok: false, status: tokenResult.status, message: tokenResult.message }
  }
  const { token } = tokenResult

  let clone: CloneResult | null = null
  try {
    clone = await cloneRepoToTemp(kbContentRoot)
    if (!clone.ok) {
      return { ok: false, status: 'kb_unavailable', message: 'Failed to clone KB content repository' }
    }

    const authenticatedUrl = buildAuthenticatedUrl(creds.repoCloneUrl, token)

    const addRemote = await runGit(
      ['remote', 'add', 'github', authenticatedUrl],
      { cwd: clone.dir, env: clone.gitEnv },
    )
    if (!addRemote.ok) {
      return { ok: false, status: 'error', message: sanitizeGitError(addRemote.stderr, token) }
    }

    const branch = await detectDefaultBranch(clone.dir, clone.gitEnv)

    const fetch = await runGit(
      ['fetch', 'github', branch],
      { cwd: clone.dir, env: clone.gitEnv },
    )
    if (!fetch.ok) {
      const sanitized = sanitizeGitError(fetch.stderr, token)
      if (isAuthFailure(fetch.stderr)) {
        return { ok: false, status: 'auth_failed', message: sanitized }
      }
      return { ok: false, status: 'error', message: sanitized }
    }

    const hasDiff = await runGit(
      ['diff', '--quiet', 'HEAD', `github/${branch}`],
      { cwd: clone.dir, env: clone.gitEnv },
    )
    if (hasDiff.ok) {
      return { ok: true, status: 'up_to_date' }
    }

    const merge = await runGit(
      ['merge', `github/${branch}`, '--no-edit'],
      { cwd: clone.dir, env: clone.gitEnv },
    )

    if (!merge.ok) {
      const conflictFiles = await runGit(
        ['diff', '--name-only', '--diff-filter=U'],
        { cwd: clone.dir, env: clone.gitEnv },
      )
      const files = conflictFiles.ok
        ? conflictFiles.stdout.trim().split('\n').filter(Boolean)
        : []

      await runGit(['merge', '--abort'], { cwd: clone.dir, env: clone.gitEnv })

      return {
        ok: false,
        status: 'conflicts',
        message: `Merge conflicts in ${files.length} file(s)`,
        conflictingFiles: files,
      }
    }

    const pushBack = await runGit(
      ['push', 'origin', `HEAD:refs/heads/${branch}`],
      { cwd: clone.dir, env: clone.gitEnv },
    )
    if (!pushBack.ok) {
      return { ok: false, status: 'error', message: 'Merged successfully but failed to update local repository' }
    }

    const head = await runGit(['rev-parse', 'HEAD'], { cwd: clone.dir, env: clone.gitEnv })
    const commitHash = head.ok ? head.stdout.trim() : 'unknown'

    return { ok: true, status: 'pulled', commitHash }
  } catch (error) {
    return { ok: false, status: 'error', message: error instanceof Error ? error.message : 'Unknown error' }
  } finally {
    if (clone && clone.ok) {
      await cleanupClone(clone)
    }
  }
}

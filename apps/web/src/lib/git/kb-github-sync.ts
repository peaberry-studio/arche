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

export type KbGithubTestResult =
  | { ok: true; remoteBranch: string }
  | { ok: false; status: 'auth_failed' | 'repo_not_found' | 'error'; message: string }

export type KbGithubPushResult =
  | { ok: true; status: 'pushed'; commitHash: string }
  | { ok: true; status: 'up_to_date' }
  | { ok: false; status: 'not_configured' | 'kb_unavailable' | 'auth_failed' | 'push_rejected' | 'error'; message: string }

export type KbGithubPullResult =
  | { ok: true; status: 'pulled'; commitHash: string }
  | { ok: true; status: 'up_to_date' }
  | { ok: false; status: 'not_configured' | 'kb_unavailable' | 'auth_failed' | 'conflicts' | 'error'; message: string; conflictingFiles?: string[] }

export function buildAuthenticatedUrl(repoUrl: string, pat: string): string {
  try {
    const url = new URL(repoUrl)
    url.username = pat
    url.password = ''
    return url.toString()
  } catch {
    return repoUrl
  }
}

export function sanitizeGitError(stderr: string, pat: string): string {
  if (!pat) return stderr
  return stderr.replaceAll(pat, '***')
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

function isRepoNotFound(stderr: string): boolean {
  const lower = stderr.toLowerCase()
  return (
    lower.includes('repository not found') ||
    lower.includes('not found') ||
    lower.includes('does not exist') ||
    lower.includes('404')
  )
}

export async function testConnection(
  repoUrl: string,
  pat: string,
): Promise<KbGithubTestResult> {
  if (!await isGitAvailable()) {
    return { ok: false, status: 'error', message: 'Git is not available' }
  }

  const authenticatedUrl = buildAuthenticatedUrl(repoUrl, pat)
  const result = await runGit(['ls-remote', '--heads', authenticatedUrl])

  if (!result.ok) {
    const sanitized = sanitizeGitError(result.stderr, pat)
    if (isAuthFailure(result.stderr)) {
      return { ok: false, status: 'auth_failed', message: sanitized }
    }
    if (isRepoNotFound(result.stderr)) {
      return { ok: false, status: 'repo_not_found', message: sanitized }
    }
    return { ok: false, status: 'error', message: sanitized }
  }

  const lines = result.stdout.trim().split('\n').filter(Boolean)
  let remoteBranch = 'main'
  if (lines.length > 0) {
    const first = lines[0]
    const match = first.match(/refs\/heads\/(.+)$/)
    if (match) {
      remoteBranch = match[1]
    }
  }

  return { ok: true, remoteBranch }
}

export async function pushToGithub(
  repoUrl: string,
  pat: string,
): Promise<KbGithubPushResult> {
  const kbContentRoot = getKbContentRoot()

  if (!await isGitAvailable()) {
    return { ok: false, status: 'kb_unavailable', message: 'Git is not available' }
  }
  if (!await hasBareRepoLayout(kbContentRoot)) {
    return { ok: false, status: 'kb_unavailable', message: 'KB content repository not found' }
  }

  let clone: CloneResult | null = null
  try {
    clone = await cloneRepoToTemp(kbContentRoot)
    if (!clone.ok) {
      return { ok: false, status: 'kb_unavailable', message: 'Failed to clone KB content repository' }
    }

    const authenticatedUrl = buildAuthenticatedUrl(repoUrl, pat)

    const addRemote = await runGit(
      ['remote', 'add', 'github', authenticatedUrl],
      { cwd: clone.dir, env: clone.gitEnv },
    )
    if (!addRemote.ok) {
      return { ok: false, status: 'error', message: sanitizeGitError(addRemote.stderr, pat) }
    }

    const branch = await detectDefaultBranch(clone.dir, clone.gitEnv)

    const push = await runGit(
      ['push', 'github', `HEAD:refs/heads/${branch}`],
      { cwd: clone.dir, env: clone.gitEnv },
    )

    if (!push.ok) {
      const sanitized = sanitizeGitError(push.stderr, pat)
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

export async function pullFromGithub(
  repoUrl: string,
  pat: string,
): Promise<KbGithubPullResult> {
  const kbContentRoot = getKbContentRoot()

  if (!await isGitAvailable()) {
    return { ok: false, status: 'kb_unavailable', message: 'Git is not available' }
  }
  if (!await hasBareRepoLayout(kbContentRoot)) {
    return { ok: false, status: 'kb_unavailable', message: 'KB content repository not found' }
  }

  let clone: CloneResult | null = null
  try {
    clone = await cloneRepoToTemp(kbContentRoot)
    if (!clone.ok) {
      return { ok: false, status: 'kb_unavailable', message: 'Failed to clone KB content repository' }
    }

    const authenticatedUrl = buildAuthenticatedUrl(repoUrl, pat)

    const addRemote = await runGit(
      ['remote', 'add', 'github', authenticatedUrl],
      { cwd: clone.dir, env: clone.gitEnv },
    )
    if (!addRemote.ok) {
      return { ok: false, status: 'error', message: sanitizeGitError(addRemote.stderr, pat) }
    }

    const branch = await detectDefaultBranch(clone.dir, clone.gitEnv)

    const fetch = await runGit(
      ['fetch', 'github', branch],
      { cwd: clone.dir, env: clone.gitEnv },
    )
    if (!fetch.ok) {
      const sanitized = sanitizeGitError(fetch.stderr, pat)
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

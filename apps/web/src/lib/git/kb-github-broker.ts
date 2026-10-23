import { execFile } from 'node:child_process'

import { createEventStrict as auditEvent } from '@/lib/services/audit'
import { KB_MAIN_REF, ZERO_OID, kbGit, readKbRef, withKbLock } from '@/lib/git/kb-publication'
import { getKbContentRoot } from '@/lib/runtime/paths'
import { kbGithubRemoteService } from '@/lib/services'

export type KbGithubResult = { ok: true; configured: boolean; incoming: boolean } | { ok: false; error: string }

export async function syncKbGithub(operation: 'fetch' | 'push', actorUserId: string): Promise<KbGithubResult> {
  const config = await kbGithubRemoteService.createBrokerRemoteConfig()
  if (!config.ok) return config
  if (!config.remote) return { ok: true, configured: false, incoming: false }
  const remote = config.remote
  try {
    const repository = getKbContentRoot()
    const incoming = await withKbLock(repository, async (signal) => {
      await kbGit(repository, ['check-ref-format', `refs/heads/${remote.branch}`], undefined, signal)
      const run = (args: string[]) => new Promise<string>((resolve, reject) => {
        execFile('git', [
          '-c', 'core.hooksPath=/dev/null', '-c', 'credential.helper=',
          '-c', 'http.followRedirects=false', '-c', 'protocol.allow=never', '-c', 'protocol.https.allow=always',
          '-c', 'fetch.fsckObjects=true', '--git-dir', repository, ...args,
        ], {
          encoding: 'utf8', timeout: 60_000, maxBuffer: 1024 * 1024, signal,
          env: {
            NODE_ENV: process.env.NODE_ENV, PATH: process.env.PATH, GIT_CONFIG_NOSYSTEM: '1', GIT_CONFIG_GLOBAL: '/dev/null', GIT_TERMINAL_PROMPT: '0',
            GIT_CONFIG_COUNT: '1', GIT_CONFIG_KEY_0: `http.${remote.repoCloneUrl}.extraheader`,
            GIT_CONFIG_VALUE_0: `Authorization: Basic ${Buffer.from(`x-access-token:${remote.token}`).toString('base64')}`,
          },
        }, (error, stdout) => error ? reject(new Error(`github_${operation}_failed`)) : resolve(stdout))
      })
      await auditEvent({ actorUserId, action: `kb.github_${operation}_requested`, metadata: { repository: remote.repoCloneUrl, branch: remote.branch } })
      if (operation === 'fetch') {
        const advertised = await run(['ls-remote', '--heads', remote.repoCloneUrl, `refs/heads/${remote.branch}`])
        if (!advertised.trim()) return false
        await run(['fetch', '--no-tags', '--no-write-fetch-head', remote.repoCloneUrl, `+refs/heads/${remote.branch}:refs/heads/arche-github`])
      } else if (await readKbRef(repository, KB_MAIN_REF) !== ZERO_OID) {
        await run(['push', remote.repoCloneUrl, `${KB_MAIN_REF}:refs/heads/${remote.branch}`])
      }
      return operation === 'fetch'
    })
    await kbGithubRemoteService.updateSyncState({ lastError: null, lastSyncAt: new Date().toISOString(), lastSyncStatus: 'success' })
    await auditEvent({ actorUserId, action: `kb.github_${operation}`, metadata: { repository: remote.repoCloneUrl, branch: remote.branch } })
    return { ok: true, configured: true, incoming }
  } catch {
    const error = `GitHub ${operation} failed. Check access and sync before retrying.`
    await kbGithubRemoteService.updateSyncState({ lastError: error, lastSyncAt: new Date().toISOString(), lastSyncStatus: 'error' })
    return { ok: false, error }
  } finally {
    try {
      const response = await fetch('https://api.github.com/installation/token', {
        method: 'DELETE', headers: { Authorization: `Bearer ${remote.token}`, Accept: 'application/vnd.github+json' },
        redirect: 'error', signal: AbortSignal.timeout(10_000),
      })
      if (!response.ok) throw new Error('revocation_failed')
    } catch {
      await auditEvent({ actorUserId, action: 'kb.github_token_revocation_failed', metadata: {} })
    }
  }
}

import { createSign } from 'node:crypto'

import type { KbGithubRemoteRepo } from '@/lib/kb-github-remote/types'

const GITHUB_API_BASE = 'https://api.github.com'
const JWT_CLOCK_DRIFT_SECONDS = 60
const JWT_EXPIRY_SECONDS = 600

export function createAppJwt(appId: string, privateKey: string): string {
  const now = Math.floor(Date.now() / 1000)
  const header = Buffer.from(JSON.stringify({ alg: 'RS256', typ: 'JWT' })).toString('base64url')
  const payload = Buffer.from(JSON.stringify({
    exp: now + JWT_EXPIRY_SECONDS,
    iat: now - JWT_CLOCK_DRIFT_SECONDS,
    iss: appId,
  })).toString('base64url')

  const signer = createSign('RSA-SHA256')
  signer.update(`${header}.${payload}`)
  const signature = signer.sign(privateKey, 'base64url')

  return `${header}.${payload}.${signature}`
}

export type InstallationTokenResult =
  | { ok: true; expiresAt: string; token: string }
  | { ok: false; message: string; status: 'auth_failed' | 'not_found' | 'error' }

export async function getInstallationToken(
  appId: string,
  privateKey: string,
  installationId: number,
): Promise<InstallationTokenResult> {
  try {
    const response = await fetch(`${GITHUB_API_BASE}/app/installations/${installationId}/access_tokens`, {
      method: 'POST',
      headers: githubAppHeaders(createAppJwt(appId, privateKey)),
    })

    if (response.status === 401) {
      return { ok: false, status: 'auth_failed', message: 'GitHub App credentials are invalid.' }
    }
    if (response.status === 404) {
      return { ok: false, status: 'not_found', message: 'GitHub App installation was not found.' }
    }
    if (!response.ok) {
      const text = await response.text().catch(() => '')
      return { ok: false, status: 'error', message: `GitHub API returned ${response.status}: ${text}` }
    }

    const data = await response.json() as { expires_at?: string; token?: string }
    if (!data.token || !data.expires_at) {
      return { ok: false, status: 'error', message: 'GitHub did not return an installation token.' }
    }

    return { ok: true, expiresAt: data.expires_at, token: data.token }
  } catch (error) {
    return {
      ok: false,
      status: 'error',
      message: error instanceof Error ? error.message : 'Failed to get GitHub installation token.',
    }
  }
}

export type InstallationReposResult =
  | { ok: true; repos: KbGithubRemoteRepoWithCloneUrl[] }
  | { ok: false; message: string }

export type KbGithubRemoteRepoWithCloneUrl = KbGithubRemoteRepo & {
  cloneUrl: string
}

export async function getInstallationRepos(
  appId: string,
  privateKey: string,
  installationId: number,
): Promise<InstallationReposResult> {
  const tokenResult = await getInstallationToken(appId, privateKey, installationId)
  if (!tokenResult.ok) {
    return { ok: false, message: tokenResult.message }
  }

  try {
    const response = await fetch(`${GITHUB_API_BASE}/installation/repositories?per_page=100`, {
      headers: githubInstallationHeaders(tokenResult.token),
    })

    if (!response.ok) {
      const text = await response.text().catch(() => '')
      return { ok: false, message: `GitHub API returned ${response.status}: ${text}` }
    }

    const data = await response.json() as {
      repositories?: Array<{
        clone_url?: string
        default_branch?: string | null
        full_name?: string
        private?: boolean
      }>
    }

    return {
      ok: true,
      repos: (data.repositories ?? [])
        .filter((repo) => repo.full_name && repo.clone_url)
        .map((repo) => ({
          cloneUrl: repo.clone_url ?? '',
          defaultBranch: repo.default_branch || 'main',
          fullName: repo.full_name ?? '',
          private: Boolean(repo.private),
        })),
    }
  } catch (error) {
    return {
      ok: false,
      message: error instanceof Error ? error.message : 'Failed to list GitHub repositories.',
    }
  }
}

export type ManifestExchangeResult =
  | {
      ok: true
      appId: number
      clientId: string
      owner: string
      pem: string
      slug: string
      webhookSecret: string
    }
  | { ok: false; message: string }

export async function exchangeManifestCode(code: string): Promise<ManifestExchangeResult> {
  try {
    const response = await fetch(`${GITHUB_API_BASE}/app-manifests/${code}/conversions`, {
      method: 'POST',
      headers: githubJsonHeaders(),
    })

    if (response.status === 404) {
      return { ok: false, message: 'GitHub App manifest code is invalid or expired.' }
    }
    if (response.status === 422) {
      return { ok: false, message: 'GitHub App manifest code has already been used.' }
    }
    if (!response.ok) {
      const text = await response.text().catch(() => '')
      return { ok: false, message: `GitHub API returned ${response.status}: ${text}` }
    }

    const data = await response.json() as {
      client_id?: string
      id?: number
      owner?: { login?: string }
      pem?: string
      slug?: string
      webhook_secret?: string
    }

    if (!data.id || !data.pem || !data.slug) {
      return { ok: false, message: 'GitHub did not return complete app credentials.' }
    }

    return {
      ok: true,
      appId: data.id,
      clientId: data.client_id ?? '',
      owner: data.owner?.login ?? '',
      pem: data.pem,
      slug: data.slug,
      webhookSecret: data.webhook_secret ?? '',
    }
  } catch (error) {
    return {
      ok: false,
      message: error instanceof Error ? error.message : 'Failed to exchange GitHub App manifest code.',
    }
  }
}

export async function verifyInstallation(
  appId: string,
  privateKey: string,
  installationId: number,
): Promise<{ ok: true; account: string } | { ok: false; message: string }> {
  try {
    const response = await fetch(`${GITHUB_API_BASE}/app/installations/${installationId}`, {
      headers: githubAppHeaders(createAppJwt(appId, privateKey)),
    })

    if (!response.ok) {
      const text = await response.text().catch(() => '')
      return { ok: false, message: `GitHub API returned ${response.status}: ${text}` }
    }

    const data = await response.json() as { account?: { login?: string } }
    return { ok: true, account: data.account?.login ?? '' }
  } catch (error) {
    return {
      ok: false,
      message: error instanceof Error ? error.message : 'Failed to verify GitHub App installation.',
    }
  }
}

function githubAppHeaders(jwt: string): Record<string, string> {
  return {
    ...githubJsonHeaders(),
    Authorization: `Bearer ${jwt}`,
  }
}

function githubInstallationHeaders(token: string): Record<string, string> {
  return {
    ...githubJsonHeaders(),
    Authorization: `Bearer ${token}`,
  }
}

function githubJsonHeaders(): Record<string, string> {
  return {
    Accept: 'application/vnd.github+json',
    'X-GitHub-Api-Version': '2022-11-28',
  }
}

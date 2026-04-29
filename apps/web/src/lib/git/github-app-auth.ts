import { createSign } from 'node:crypto'

const GITHUB_API_BASE = 'https://api.github.com'
const JWT_EXPIRY_SECONDS = 600
const JWT_CLOCK_DRIFT_SECONDS = 60

export function createAppJwt(appId: string, privateKey: string): string {
  const now = Math.floor(Date.now() / 1000)
  const header = Buffer.from(JSON.stringify({ alg: 'RS256', typ: 'JWT' })).toString('base64url')
  const payload = Buffer.from(
    JSON.stringify({
      iat: now - JWT_CLOCK_DRIFT_SECONDS,
      exp: now + JWT_EXPIRY_SECONDS,
      iss: appId,
    }),
  ).toString('base64url')

  const sign = createSign('RSA-SHA256')
  sign.update(`${header}.${payload}`)
  const signature = sign.sign(privateKey, 'base64url')

  return `${header}.${payload}.${signature}`
}

export type InstallationTokenResult =
  | { ok: true; token: string; expiresAt: string }
  | { ok: false; status: 'auth_failed' | 'not_found' | 'error'; message: string }

export async function getInstallationToken(
  appId: string,
  privateKey: string,
  installationId: number,
): Promise<InstallationTokenResult> {
  try {
    const jwt = createAppJwt(appId, privateKey)
    const response = await fetch(
      `${GITHUB_API_BASE}/app/installations/${installationId}/access_tokens`,
      {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${jwt}`,
          Accept: 'application/vnd.github+json',
          'X-GitHub-Api-Version': '2022-11-28',
        },
      },
    )

    if (response.status === 401) {
      return { ok: false, status: 'auth_failed', message: 'GitHub App credentials are invalid' }
    }
    if (response.status === 404) {
      return { ok: false, status: 'not_found', message: 'Installation not found — the app may have been uninstalled' }
    }
    if (!response.ok) {
      const text = await response.text().catch(() => '')
      return { ok: false, status: 'error', message: `GitHub API returned ${response.status}: ${text}` }
    }

    const data = (await response.json()) as { token: string; expires_at: string }
    return { ok: true, token: data.token, expiresAt: data.expires_at }
  } catch (error) {
    return {
      ok: false,
      status: 'error',
      message: error instanceof Error ? error.message : 'Failed to get installation token',
    }
  }
}

export type InstallationRepo = {
  fullName: string
  cloneUrl: string
  private: boolean
}

export type InstallationReposResult =
  | { ok: true; repos: InstallationRepo[] }
  | { ok: false; message: string }

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
      headers: {
        Authorization: `Bearer ${tokenResult.token}`,
        Accept: 'application/vnd.github+json',
        'X-GitHub-Api-Version': '2022-11-28',
      },
    })

    if (!response.ok) {
      return { ok: false, message: `GitHub API returned ${response.status}` }
    }

    const data = (await response.json()) as {
      repositories: Array<{ full_name: string; clone_url: string; private: boolean }>
    }

    return {
      ok: true,
      repos: data.repositories.map((r) => ({
        fullName: r.full_name,
        cloneUrl: r.clone_url,
        private: r.private,
      })),
    }
  } catch (error) {
    return {
      ok: false,
      message: error instanceof Error ? error.message : 'Failed to list installation repos',
    }
  }
}

export type ManifestExchangeResult =
  | { ok: true; appId: number; slug: string; pem: string; clientId: string; webhookSecret: string; owner: string }
  | { ok: false; message: string }

export async function exchangeManifestCode(code: string): Promise<ManifestExchangeResult> {
  try {
    const response = await fetch(`${GITHUB_API_BASE}/app-manifests/${code}/conversions`, {
      method: 'POST',
      headers: {
        Accept: 'application/vnd.github+json',
        'X-GitHub-Api-Version': '2022-11-28',
      },
    })

    if (response.status === 404) {
      return { ok: false, message: 'Invalid or expired manifest code' }
    }
    if (response.status === 422) {
      return { ok: false, message: 'Manifest code has already been used' }
    }
    if (!response.ok) {
      const text = await response.text().catch(() => '')
      return { ok: false, message: `GitHub API returned ${response.status}: ${text}` }
    }

    const data = (await response.json()) as {
      id: number
      slug: string
      pem: string
      client_id: string
      webhook_secret: string
      owner: { login: string }
    }

    return {
      ok: true,
      appId: data.id,
      slug: data.slug,
      pem: data.pem,
      clientId: data.client_id,
      webhookSecret: data.webhook_secret,
      owner: data.owner.login,
    }
  } catch (error) {
    return {
      ok: false,
      message: error instanceof Error ? error.message : 'Failed to exchange manifest code',
    }
  }
}

export async function verifyInstallation(
  appId: string,
  privateKey: string,
  installationId: number,
): Promise<{ ok: true; account: string } | { ok: false; message: string }> {
  try {
    const jwt = createAppJwt(appId, privateKey)
    const response = await fetch(`${GITHUB_API_BASE}/app/installations/${installationId}`, {
      headers: {
        Authorization: `Bearer ${jwt}`,
        Accept: 'application/vnd.github+json',
        'X-GitHub-Api-Version': '2022-11-28',
      },
    })

    if (!response.ok) {
      return { ok: false, message: `GitHub API returned ${response.status}` }
    }

    const data = (await response.json()) as { account: { login: string } }
    return { ok: true, account: data.account.login }
  } catch (error) {
    return {
      ok: false,
      message: error instanceof Error ? error.message : 'Failed to verify installation',
    }
  }
}

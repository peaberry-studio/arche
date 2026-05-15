import { createVerify, generateKeyPairSync } from 'node:crypto'

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import {
  createAppJwt,
  exchangeManifestCode,
  getInstallationRepos,
  getInstallationToken,
  verifyInstallation,
} from '@/lib/git/github-app-auth'

const fetchMock = vi.fn<(input: RequestInfo | URL, init?: RequestInit) => Promise<Response>>()

const { privateKey, publicKey } = generateKeyPairSync('rsa', { modulusLength: 2048 })
const PRIVATE_KEY = privateKey.export({ type: 'pkcs8', format: 'pem' }).toString()
const PUBLIC_KEY = publicKey.export({ type: 'spki', format: 'pem' }).toString()

function jsonResponse(body: unknown, init?: ResponseInit): Response {
  return new Response(JSON.stringify(body), {
    headers: { 'content-type': 'application/json' },
    ...init,
  })
}

function textResponse(body: string, init?: ResponseInit): Response {
  return new Response(body, init)
}

describe('github-app-auth', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-05-15T12:00:00.000Z'))
    vi.stubGlobal('fetch', fetchMock)
    fetchMock.mockReset()
  })

  afterEach(() => {
    vi.useRealTimers()
    vi.unstubAllGlobals()
  })

  it('creates a signed GitHub App JWT', () => {
    const jwt = createAppJwt('123', PRIVATE_KEY)
    const [header, payload, signature] = jwt.split('.')

    expect(JSON.parse(Buffer.from(header, 'base64url').toString('utf8'))).toEqual({ alg: 'RS256', typ: 'JWT' })
    expect(JSON.parse(Buffer.from(payload, 'base64url').toString('utf8'))).toEqual({
      exp: 1778847000,
      iat: 1778846340,
      iss: '123',
    })

    const verifier = createVerify('RSA-SHA256')
    verifier.update(`${header}.${payload}`)
    expect(verifier.verify(PUBLIC_KEY, signature, 'base64url')).toBe(true)
  })

  it('gets an installation token', async () => {
    fetchMock.mockResolvedValue(jsonResponse({ expires_at: '2026-05-15T13:00:00Z', token: 'token-1' }))

    await expect(getInstallationToken('123', PRIVATE_KEY, 456)).resolves.toEqual({
      ok: true,
      expiresAt: '2026-05-15T13:00:00Z',
      token: 'token-1',
    })
    expect(fetchMock).toHaveBeenCalledWith(
      'https://api.github.com/app/installations/456/access_tokens',
      expect.objectContaining({
        headers: expect.objectContaining({
          Accept: 'application/vnd.github+json',
          Authorization: expect.stringMatching(/^Bearer /),
          'X-GitHub-Api-Version': '2022-11-28',
        }),
        method: 'POST',
      }),
    )
  })

  it.each([
    [401, 'auth_failed', 'GitHub App credentials are invalid.'],
    [404, 'not_found', 'GitHub App installation was not found.'],
  ])('maps installation token status %s', async (status, expectedStatus, message) => {
    fetchMock.mockResolvedValue(textResponse('', { status }))

    await expect(getInstallationToken('123', PRIVATE_KEY, 456)).resolves.toEqual({
      ok: false,
      status: expectedStatus,
      message,
    })
  })

  it('returns GitHub API errors when token creation fails', async () => {
    fetchMock.mockResolvedValue(textResponse('boom', { status: 500 }))

    await expect(getInstallationToken('123', PRIVATE_KEY, 456)).resolves.toEqual({
      ok: false,
      status: 'error',
      message: 'GitHub API returned 500: boom',
    })
  })

  it('rejects token responses missing token fields', async () => {
    fetchMock.mockResolvedValue(jsonResponse({ token: 'token-1' }))

    await expect(getInstallationToken('123', PRIVATE_KEY, 456)).resolves.toEqual({
      ok: false,
      status: 'error',
      message: 'GitHub did not return an installation token.',
    })
  })

  it('returns fetch errors when token creation throws', async () => {
    fetchMock.mockRejectedValue(new Error('network down'))

    await expect(getInstallationToken('123', PRIVATE_KEY, 456)).resolves.toEqual({
      ok: false,
      status: 'error',
      message: 'network down',
    })
  })

  it('lists installation repositories and filters incomplete entries', async () => {
    fetchMock
      .mockResolvedValueOnce(jsonResponse({ expires_at: '2026-05-15T13:00:00Z', token: 'token-1' }))
      .mockResolvedValueOnce(jsonResponse({
        repositories: [
          { clone_url: 'https://github.com/acme/kb.git', default_branch: 'trunk', full_name: 'acme/kb', private: true },
          { clone_url: 'https://github.com/acme/docs.git', default_branch: null, full_name: 'acme/docs', private: false },
          { clone_url: '', full_name: 'acme/skip' },
          { clone_url: 'https://github.com/acme/missing-name.git' },
        ],
      }))

    await expect(getInstallationRepos('123', PRIVATE_KEY, 456)).resolves.toEqual({
      ok: true,
      repos: [
        { cloneUrl: 'https://github.com/acme/kb.git', defaultBranch: 'trunk', fullName: 'acme/kb', private: true },
        { cloneUrl: 'https://github.com/acme/docs.git', defaultBranch: 'main', fullName: 'acme/docs', private: false },
      ],
    })
    expect(fetchMock).toHaveBeenLastCalledWith(
      'https://api.github.com/installation/repositories?per_page=100',
      expect.objectContaining({ headers: expect.objectContaining({ Authorization: 'Bearer token-1' }) }),
    )
  })

  it('returns token errors before listing repositories', async () => {
    fetchMock.mockResolvedValue(textResponse('', { status: 401 }))

    await expect(getInstallationRepos('123', PRIVATE_KEY, 456)).resolves.toEqual({
      ok: false,
      message: 'GitHub App credentials are invalid.',
    })
  })

  it('returns API errors when repository listing fails', async () => {
    fetchMock
      .mockResolvedValueOnce(jsonResponse({ expires_at: '2026-05-15T13:00:00Z', token: 'token-1' }))
      .mockResolvedValueOnce(textResponse('nope', { status: 403 }))

    await expect(getInstallationRepos('123', PRIVATE_KEY, 456)).resolves.toEqual({
      ok: false,
      message: 'GitHub API returned 403: nope',
    })
  })

  it('returns fetch errors when repository listing throws', async () => {
    fetchMock
      .mockResolvedValueOnce(jsonResponse({ expires_at: '2026-05-15T13:00:00Z', token: 'token-1' }))
      .mockRejectedValueOnce(new Error('repo fetch failed'))

    await expect(getInstallationRepos('123', PRIVATE_KEY, 456)).resolves.toEqual({
      ok: false,
      message: 'repo fetch failed',
    })
  })

  it('exchanges a manifest code for GitHub App credentials', async () => {
    fetchMock.mockResolvedValue(jsonResponse({
      client_id: 'client-1',
      id: 123,
      owner: { login: 'acme' },
      pem: 'pem',
      slug: 'arche-kb-sync',
      webhook_secret: 'secret',
    }))

    await expect(exchangeManifestCode('code-1')).resolves.toEqual({
      ok: true,
      appId: 123,
      clientId: 'client-1',
      owner: 'acme',
      pem: 'pem',
      slug: 'arche-kb-sync',
      webhookSecret: 'secret',
    })
  })

  it.each([
    [404, 'GitHub App manifest code is invalid or expired.'],
    [422, 'GitHub App manifest code has already been used.'],
  ])('maps manifest exchange status %s', async (status, message) => {
    fetchMock.mockResolvedValue(textResponse('', { status }))

    await expect(exchangeManifestCode('code-1')).resolves.toEqual({ ok: false, message })
  })

  it('returns manifest exchange API errors', async () => {
    fetchMock.mockResolvedValue(textResponse('bad manifest', { status: 500 }))

    await expect(exchangeManifestCode('code-1')).resolves.toEqual({
      ok: false,
      message: 'GitHub API returned 500: bad manifest',
    })
  })

  it('requires complete manifest credentials', async () => {
    fetchMock.mockResolvedValue(jsonResponse({ id: 123, slug: 'arche-kb-sync' }))

    await expect(exchangeManifestCode('code-1')).resolves.toEqual({
      ok: false,
      message: 'GitHub did not return complete app credentials.',
    })
  })

  it('returns fetch errors when manifest exchange throws', async () => {
    fetchMock.mockRejectedValue('network down')

    await expect(exchangeManifestCode('code-1')).resolves.toEqual({
      ok: false,
      message: 'Failed to exchange GitHub App manifest code.',
    })
  })

  it('verifies an installation', async () => {
    fetchMock.mockResolvedValue(jsonResponse({ account: { login: 'acme' } }))

    await expect(verifyInstallation('123', PRIVATE_KEY, 456)).resolves.toEqual({ ok: true, account: 'acme' })
  })

  it('handles missing installation account names', async () => {
    fetchMock.mockResolvedValue(jsonResponse({ account: {} }))

    await expect(verifyInstallation('123', PRIVATE_KEY, 456)).resolves.toEqual({ ok: true, account: '' })
  })

  it('returns API errors when installation verification fails', async () => {
    fetchMock.mockResolvedValue(textResponse('not found', { status: 404 }))

    await expect(verifyInstallation('123', PRIVATE_KEY, 456)).resolves.toEqual({
      ok: false,
      message: 'GitHub API returned 404: not found',
    })
  })

  it('returns fetch errors when installation verification throws', async () => {
    fetchMock.mockRejectedValue(new Error('verify failed'))

    await expect(verifyInstallation('123', PRIVATE_KEY, 456)).resolves.toEqual({
      ok: false,
      message: 'verify failed',
    })
  })
})

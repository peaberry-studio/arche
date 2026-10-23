import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({ exec: vi.fn(), config: vi.fn(), state: vi.fn(), audit: vi.fn(), git: vi.fn(), ref: vi.fn() }))
vi.mock('node:child_process', () => ({ execFile: mocks.exec }))
vi.mock('@/lib/services/audit', () => ({ createEventStrict: mocks.audit }))
vi.mock('@/lib/runtime/paths', () => ({ getKbContentRoot: () => '/trusted/kb.git' }))
vi.mock('@/lib/git/kb-publication', () => ({
  KB_MAIN_REF: 'refs/heads/main', ZERO_OID: '0'.repeat(40), kbGit: mocks.git, readKbRef: mocks.ref,
  withKbLock: async (_repository: string, run: (signal: AbortSignal) => Promise<unknown>) => run(new AbortController().signal),
}))
vi.mock('@/lib/services', () => ({ kbGithubRemoteService: { createBrokerRemoteConfig: mocks.config, updateSyncState: mocks.state } }))

import { syncKbGithub } from '@/lib/git/kb-github-broker'

const token = 'installation-secret-for-regression'
const remote = { branch: 'main', repoCloneUrl: 'https://github.com/acme/kb.git', token }
beforeEach(() => {
  vi.resetAllMocks()
  mocks.config.mockResolvedValue({ ok: true, remote })
  mocks.ref.mockResolvedValue('a'.repeat(40))
  mocks.exec.mockImplementation((_file, args: string[], _options, callback: (error: Error | null, stdout: string) => void) => {
    callback(null, args.includes('ls-remote') ? `${'a'.repeat(40)}\trefs/heads/main\n` : '')
  })
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(null, { status: 204 })))
})

describe('GitHub credentials stay in the BFF broker', () => {
  it('fetches into an incoming ref without publishing, never puts credentials in arguments or results, then revokes the token', async () => {
    const result = await syncKbGithub('fetch', 'user-1')
    expect(result).toEqual({ ok: true, configured: true, incoming: true })
    expect(mocks.exec).toHaveBeenCalledTimes(2)
    const [command, args, options] = mocks.exec.mock.calls[1]
    expect(command).toBe('git')
    expect(args).toContain('+refs/heads/main:refs/heads/arche-github')
    expect(args).toContain('http.followRedirects=false')
    expect(args).toContain('credential.helper=')
    expect(JSON.stringify(args)).not.toContain(token)
    expect(options.env.GIT_CONFIG_KEY_0).toBe(`http.${remote.repoCloneUrl}.extraheader`)
    expect(options.env.GIT_CONFIG_VALUE_0).toBe(`Authorization: Basic ${Buffer.from(`x-access-token:${token}`).toString('base64')}`)
    expect(JSON.stringify(result)).not.toContain(token)
    expect(JSON.stringify(mocks.audit.mock.calls)).not.toContain(token)
    expect(fetch).toHaveBeenCalledWith('https://api.github.com/installation/token', expect.objectContaining({ method: 'DELETE', redirect: 'error' }))
  })
  it('exports only approved main, never a workspace or proposal ref', async () => {
    await syncKbGithub('push', 'admin-1')
    expect(mocks.exec.mock.calls[0][1].slice(-3)).toEqual(['push', remote.repoCloneUrl, 'refs/heads/main:refs/heads/main'])
    expect(mocks.audit).toHaveBeenCalledWith(expect.objectContaining({ actorUserId: 'admin-1', action: 'kb.github_push' }))
  })
  it('supports an empty remote without treating missing branches as credential failures', async () => {
    mocks.exec.mockImplementation((_file, _args, _options, callback: (error: Error | null, stdout: string) => void) => callback(null, ''))
    expect(await syncKbGithub('fetch', 'user-1')).toEqual({ ok: true, configured: true, incoming: false })
    expect(mocks.exec).toHaveBeenCalledTimes(1)
  })
  it('sanitizes process errors and revokes credentials even when Git fails', async () => {
    mocks.exec.mockImplementation((_file, _args, _options, callback: (error: Error | null, stdout: string) => void) => callback(new Error(token), ''))
    const result = await syncKbGithub('push', 'admin-1')
    expect(result.ok).toBe(false)
    expect(JSON.stringify([result, mocks.audit.mock.calls, mocks.state.mock.calls])).not.toContain(token)
    expect(fetch).toHaveBeenCalledWith('https://api.github.com/installation/token', expect.objectContaining({ method: 'DELETE' }))
  })
  it('records token revocation failure without logging credentials', async () => {
    vi.mocked(fetch).mockRejectedValue(new Error(token))
    await syncKbGithub('push', 'admin-1')
    expect(mocks.audit).toHaveBeenCalledWith({ actorUserId: 'admin-1', action: 'kb.github_token_revocation_failed', metadata: {} })
    expect(JSON.stringify(mocks.audit.mock.calls)).not.toContain(token)
  })
  it('does not run Git or contact providers without a configured remote', async () => {
    mocks.config.mockResolvedValue({ ok: true, remote: null })
    expect(await syncKbGithub('fetch', 'user-1')).toEqual({ ok: true, configured: false, incoming: false })
    expect(mocks.exec).not.toHaveBeenCalled()
    expect(fetch).not.toHaveBeenCalled()
  })
})

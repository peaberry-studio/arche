import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const mockFindCredentialsBySlug = vi.fn()
const mockDecryptPassword = vi.fn()
const mockFetch = vi.fn()

vi.mock('@/lib/services', () => ({
  instanceService: {
    findCredentialsBySlug: (...args: unknown[]) => mockFindCredentialsBySlug(...args),
  },
}))

vi.mock('@/lib/spawner/crypto', () => ({
  decryptPassword: (...args: unknown[]) => mockDecryptPassword(...args),
}))

describe('createWorkspaceAgentClient', () => {
  const originalEnv = process.env
  const originalFetch = globalThis.fetch

  beforeEach(() => {
    vi.resetModules()
    vi.clearAllMocks()
    globalThis.fetch = mockFetch
    process.env = { ...originalEnv }
    delete process.env.ARCHE_RUNTIME_MODE
    delete process.env.WORKSPACE_AGENT_PORT
    delete process.env.ARCHE_DESKTOP_WORKSPACE_AGENT_PORT
    delete process.env.ARCHE_ENABLE_E2E_HOOKS
    delete process.env.ARCHE_E2E_RUNTIME_BASE_URL
    delete process.env.ARCHE_E2E_RUNTIME_PASSWORD

    mockFindCredentialsBySlug.mockResolvedValue({
      serverPassword: 'encrypted-password',
      status: 'running',
    })
    mockDecryptPassword.mockReturnValue('plain-password')
  })

  afterEach(() => {
    process.env = originalEnv
    globalThis.fetch = originalFetch
  })

  it('uses the IPv4 loopback host for the workspace agent in desktop mode', async () => {
    process.env.ARCHE_RUNTIME_MODE = 'desktop'
    process.env.ARCHE_DESKTOP_PLATFORM = 'darwin'
    process.env.ARCHE_DESKTOP_WEB_HOST = '127.0.0.1'

    const { createWorkspaceAgentClient } = await import('../client')
    const agent = await createWorkspaceAgentClient('local')

    expect(agent).toEqual({
      baseUrl: 'http://127.0.0.1:4097',
      authHeader: expect.any(String),
    })
  })

  it('uses the runtime-selected workspace-agent port in desktop mode', async () => {
    process.env.ARCHE_RUNTIME_MODE = 'desktop'
    process.env.ARCHE_DESKTOP_PLATFORM = 'darwin'
    process.env.ARCHE_DESKTOP_WEB_HOST = '127.0.0.1'
    process.env.ARCHE_DESKTOP_WORKSPACE_AGENT_PORT = '4197'

    const { createWorkspaceAgentClient } = await import('../client')
    const agent = await createWorkspaceAgentClient('local')

    expect(agent).toEqual({
      baseUrl: 'http://127.0.0.1:4197',
      authHeader: expect.any(String),
    })
  })

  it('uses the container hostname in web mode', async () => {
    process.env.ARCHE_RUNTIME_MODE = 'web'

    const { createWorkspaceAgentClient } = await import('../client')
    const agent = await createWorkspaceAgentClient('alice')

    expect(agent).toEqual({
      baseUrl: 'http://opencode-alice:4097',
      authHeader: expect.any(String),
    })
  })

  it('uses the shared E2E runtime URL in fake mode', async () => {
    process.env.ARCHE_ENABLE_E2E_HOOKS = '1'
    process.env.ARCHE_E2E_RUNTIME_BASE_URL = 'http://127.0.0.1:4210/'
    process.env.ARCHE_E2E_RUNTIME_PASSWORD = 'fake-password'

    const { getWorkspaceAgentUrl, createWorkspaceAgentClient } = await import('../client')
    const agent = await createWorkspaceAgentClient('alice')

    expect(getWorkspaceAgentUrl('alice')).toBe('http://127.0.0.1:4210')
    expect(agent).toEqual({
      baseUrl: 'http://127.0.0.1:4210',
      authHeader: expect.any(String),
    })
    expect(mockDecryptPassword).not.toHaveBeenCalled()
  })

  it('accepts an explicit workspace-agent URL override', async () => {
    const { getWorkspaceAgentUrl, createWorkspaceAgentClient } = await import('../client')
    const agent = await createWorkspaceAgentClient('alice', 'http://workspace-agent-override:4998')

    expect(getWorkspaceAgentUrl('alice', 'http://workspace-agent-override:4998')).toBe(
      'http://workspace-agent-override:4998',
    )
    expect(agent).toEqual({
      baseUrl: 'http://workspace-agent-override:4998',
      authHeader: expect.any(String),
    })
  })

  it('returns null when no running instance credentials are available', async () => {
    const { createWorkspaceAgentClient } = await import('../client')

    mockFindCredentialsBySlug.mockResolvedValueOnce(null)
    await expect(createWorkspaceAgentClient('missing')).resolves.toBeNull()

    mockFindCredentialsBySlug.mockResolvedValueOnce({ serverPassword: null, status: 'running' })
    await expect(createWorkspaceAgentClient('missing-password')).resolves.toBeNull()

    mockFindCredentialsBySlug.mockResolvedValueOnce({ serverPassword: 'encrypted-password', status: 'stopped' })
    await expect(createWorkspaceAgentClient('stopped')).resolves.toBeNull()
  })

  it('returns null when password decryption fails', async () => {
    const consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined)
    mockDecryptPassword.mockImplementationOnce(() => { throw new Error('bad password') })

    const { createWorkspaceAgentClient } = await import('../client')

    await expect(createWorkspaceAgentClient('alice')).resolves.toBeNull()
    expect(consoleErrorSpy).toHaveBeenCalledWith('[workspace-agent] Failed to decrypt password for alice')
    consoleErrorSpy.mockRestore()
  })
})

describe('workspaceAgentFetch', () => {
  const originalFetch = globalThis.fetch

  beforeEach(() => {
    vi.clearAllMocks()
    globalThis.fetch = mockFetch
  })

  afterEach(() => {
    globalThis.fetch = originalFetch
  })

  it('returns data on successful response with ok=true', async () => {
    mockFetch.mockResolvedValue({
      status: 200,
      ok: true,
      json: async () => ({ ok: true, data: { message: 'hello' } }),
    } as Response)

    const { workspaceAgentFetch } = await import('@/lib/workspace-agent-client')
    const result = await workspaceAgentFetch(
      { baseUrl: 'http://localhost:4097', authHeader: 'Basic abc' },
      '/api/test',
    )

    expect(result).toEqual({
      ok: true,
      data: { ok: true, data: { message: 'hello' } },
      status: 200,
    })
    expect(mockFetch).toHaveBeenCalledWith('http://localhost:4097/api/test', {
      method: 'POST',
      headers: {
        Authorization: 'Basic abc',
        'Content-Type': 'application/json',
        Accept: 'application/json',
      },
      body: '{}',
      cache: 'no-store',
    })
  })

  it('sends custom body and method when provided', async () => {
    mockFetch.mockResolvedValue({
      status: 200,
      ok: true,
      json: async () => ({ ok: true }),
    } as Response)

    const { workspaceAgentFetch } = await import('@/lib/workspace-agent-client')
    await workspaceAgentFetch(
      { baseUrl: 'http://localhost:4097', authHeader: 'Basic abc' },
      '/api/test',
      { foo: 'bar' },
      { method: 'PUT' },
    )

    expect(mockFetch).toHaveBeenCalledWith('http://localhost:4097/api/test', {
      method: 'PUT',
      headers: {
        Authorization: 'Basic abc',
        'Content-Type': 'application/json',
        Accept: 'application/json',
      },
      body: JSON.stringify({ foo: 'bar' }),
      cache: 'no-store',
    })
  })

  it('returns error for non-JSON response', async () => {
    mockFetch.mockResolvedValue({
      status: 500,
      ok: false,
      json: async () => { throw new Error('not json') },
    } as Response)

    const { workspaceAgentFetch } = await import('@/lib/workspace-agent-client')
    const result = await workspaceAgentFetch(
      { baseUrl: 'http://localhost:4097', authHeader: 'Basic abc' },
      '/api/test',
    )

    expect(result).toEqual({ ok: false, error: 'non-json response', status: 500 })
  })

  it('returns error with body.error when http response is not ok', async () => {
    mockFetch.mockResolvedValue({
      status: 404,
      ok: false,
      json: async () => ({ ok: true, error: 'not found' }),
    } as Response)

    const { workspaceAgentFetch } = await import('@/lib/workspace-agent-client')
    const result = await workspaceAgentFetch(
      { baseUrl: 'http://localhost:4097', authHeader: 'Basic abc' },
      '/api/test',
    )

    expect(result).toEqual({ ok: false, error: 'not found', status: 404 })
  })

  it('returns default error when http response is not ok and no body.error', async () => {
    mockFetch.mockResolvedValue({
      status: 502,
      ok: false,
      json: async () => ({ ok: true }),
    } as Response)

    const { workspaceAgentFetch } = await import('@/lib/workspace-agent-client')
    const result = await workspaceAgentFetch(
      { baseUrl: 'http://localhost:4097', authHeader: 'Basic abc' },
      '/api/test',
    )

    expect(result).toEqual({ ok: false, error: 'workspace_agent_http_502', status: 502 })
  })

  it('returns error when body.ok is false', async () => {
    mockFetch.mockResolvedValue({
      status: 200,
      ok: true,
      json: async () => ({ ok: false, error: 'agent rejected request' }),
    } as Response)

    const { workspaceAgentFetch } = await import('@/lib/workspace-agent-client')
    const result = await workspaceAgentFetch(
      { baseUrl: 'http://localhost:4097', authHeader: 'Basic abc' },
      '/api/test',
    )

    expect(result).toEqual({ ok: false, error: 'agent rejected request', status: 200 })
  })

  it('returns default error when body.ok is false and no error field', async () => {
    mockFetch.mockResolvedValue({
      status: 200,
      ok: true,
      json: async () => ({ ok: false }),
    } as Response)

    const { workspaceAgentFetch } = await import('@/lib/workspace-agent-client')
    const result = await workspaceAgentFetch(
      { baseUrl: 'http://localhost:4097', authHeader: 'Basic abc' },
      '/api/test',
    )

    expect(result).toEqual({ ok: false, error: 'workspace_agent_error', status: 200 })
  })
})

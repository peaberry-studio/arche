import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const mockFindCredentialsBySlug = vi.fn()
const mockDecryptPassword = vi.fn()

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

  beforeEach(() => {
    vi.resetModules()
    vi.clearAllMocks()
    process.env = { ...originalEnv }
    delete process.env.ARCHE_RUNTIME_MODE
    delete process.env.WORKSPACE_AGENT_PORT
    delete process.env.ARCHE_DESKTOP_WORKSPACE_AGENT_PORT

    mockFindCredentialsBySlug.mockResolvedValue({
      serverPassword: 'encrypted-password',
      status: 'running',
    })
    mockDecryptPassword.mockReturnValue('plain-password')
  })

  afterEach(() => {
    process.env = originalEnv
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
})

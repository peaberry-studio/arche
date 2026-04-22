import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const mockCreateOpencodeClient = vi.fn()
const mockFindCredentialsBySlug = vi.fn()
const mockDecryptPassword = vi.fn()

vi.mock('@opencode-ai/sdk/v2/client', () => ({
  createOpencodeClient: (...args: unknown[]) => mockCreateOpencodeClient(...args),
}))

vi.mock('@/lib/services', () => ({
  instanceService: {
    findCredentialsBySlug: (...args: unknown[]) => mockFindCredentialsBySlug(...args),
  },
}))

vi.mock('@/lib/spawner/crypto', () => ({
  decryptPassword: (...args: unknown[]) => mockDecryptPassword(...args),
}))

describe('getInstanceUrl', () => {
  const originalEnv = process.env

  beforeEach(() => {
    vi.resetModules()
    vi.clearAllMocks()
    process.env = { ...originalEnv }
    delete process.env.ARCHE_RUNTIME_MODE
    delete process.env.ARCHE_DESKTOP_OPENCODE_PORT
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
  })

  it('uses container hostnames in web mode', async () => {
    process.env.ARCHE_RUNTIME_MODE = 'web'

    const { getInstanceUrl } = await import('../client')

    expect(getInstanceUrl('alice')).toBe('http://opencode-alice:4096')
  })

  it('uses loopback with the default desktop port in desktop mode', async () => {
    process.env.ARCHE_RUNTIME_MODE = 'desktop'
    process.env.ARCHE_DESKTOP_PLATFORM = 'darwin'
    process.env.ARCHE_DESKTOP_WEB_HOST = '127.0.0.1'

    const { getInstanceUrl } = await import('../client')

    expect(getInstanceUrl('local')).toBe('http://127.0.0.1:4096')
  })

  it('uses the runtime-selected desktop port when available', async () => {
    process.env.ARCHE_RUNTIME_MODE = 'desktop'
    process.env.ARCHE_DESKTOP_PLATFORM = 'darwin'
    process.env.ARCHE_DESKTOP_WEB_HOST = '127.0.0.1'
    process.env.ARCHE_DESKTOP_OPENCODE_PORT = '4196'

    const { getInstanceUrl } = await import('../client')

    expect(getInstanceUrl('local')).toBe('http://127.0.0.1:4196')
  })

  it('uses the explicit E2E runtime base URL when fake mode is active', async () => {
    process.env.ARCHE_ENABLE_E2E_HOOKS = '1'
    process.env.ARCHE_E2E_RUNTIME_BASE_URL = 'http://127.0.0.1:4210/'
    process.env.ARCHE_E2E_RUNTIME_PASSWORD = 'fake-password'

    const { getInstanceUrl } = await import('../client')

    expect(getInstanceUrl('alice')).toBe('http://127.0.0.1:4210')
  })

  it('prefers an explicit URL override outside E2E fake mode', async () => {
    const { getInstanceUrl } = await import('../client')

    expect(getInstanceUrl('alice', 'http://runtime-override:4999')).toBe('http://runtime-override:4999')
  })
})

describe('createInstanceClient', () => {
  const originalEnv = process.env

  beforeEach(() => {
    vi.resetModules()
    vi.clearAllMocks()
    process.env = { ...originalEnv }
    process.env.ARCHE_ENABLE_E2E_HOOKS = '1'
    process.env.ARCHE_E2E_RUNTIME_BASE_URL = 'http://127.0.0.1:4210'
    process.env.ARCHE_E2E_RUNTIME_PASSWORD = 'fake-password'
    mockFindCredentialsBySlug.mockResolvedValue({
      serverPassword: 'encrypted-password',
      status: 'running',
    })
    mockDecryptPassword.mockReturnValue('plain-password')
  })

  afterEach(() => {
    vi.unstubAllGlobals()
    process.env = originalEnv
  })

  it('uses the fake runtime HTTP client instead of the SDK', async () => {
    const mockFetch = vi.fn((input: RequestInfo | URL) => {
      const url = String(input)

      if (url.endsWith('/__e2e/health')) {
        return Promise.resolve(
          new Response(JSON.stringify({ ok: true, version: 'e2e-fake-runtime' }), { status: 200 }),
        )
      }

      if (url.endsWith('/__e2e/sessions')) {
        return Promise.resolve(
          new Response(JSON.stringify({ ok: true, sessions: [{ id: 'session-1', title: 'Session 1', createdAt: 1, updatedAt: 2 }] }), { status: 200 }),
        )
      }

      return Promise.reject(new Error(`unexpected fetch ${url}`))
    })

    vi.stubGlobal('fetch', mockFetch)

    const { createInstanceClient } = await import('../client')
    const client = await createInstanceClient('alice')

    expect(client).not.toBeNull()
    expect(mockCreateOpencodeClient).not.toHaveBeenCalled()
    await expect(client!.global.health()).resolves.toEqual({
      data: { healthy: true, version: 'e2e-fake-runtime' },
    })
    await expect(client!.session.list()).resolves.toEqual({
      data: [
        {
          id: 'session-1',
          title: 'Session 1',
          parentID: null,
          time: { created: 1, updated: 2 },
        },
      ],
    })
  })

  it('supports every fake runtime operation Arche exercises in smoke flows', async () => {
    const mockFetch = vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input)
      const method = init?.method ?? 'GET'

      if (url.endsWith('/__e2e/sessions') && method === 'POST') {
        return Promise.resolve(
          new Response(
            JSON.stringify({
              ok: true,
              session: { id: 'session-2', title: 'Created', createdAt: 3, updatedAt: 4 },
            }),
            { status: 201 },
          ),
        )
      }

      if (url.endsWith('/__e2e/sessions/session-1') && method === 'PATCH') {
        return Promise.resolve(
          new Response(
            JSON.stringify({
              ok: true,
              session: { id: 'session-1', title: 'Renamed', createdAt: 1, updatedAt: 5 },
            }),
            { status: 200 },
          ),
        )
      }

      if (url.endsWith('/__e2e/sessions/session-1') && method === 'DELETE') {
        return Promise.resolve(new Response(JSON.stringify({ ok: true }), { status: 200 }))
      }

      if (url.endsWith('/__e2e/sessions/session-1/messages')) {
        return Promise.resolve(
          new Response(
            JSON.stringify({
              ok: true,
              messages: [
                { id: 'message-1', role: 'user', sessionId: 'session-1', text: 'hello', createdAt: 11 },
                { id: 'message-2', role: 'assistant', sessionId: 'session-1', text: 'world', createdAt: 12 },
              ],
            }),
            { status: 200 },
          ),
        )
      }

      if (url.endsWith('/__e2e/sessions/status')) {
        return Promise.resolve(
          new Response(JSON.stringify({ ok: true, sessions: [{ id: 'session-1', status: 'busy' }] }), {
            status: 200,
          }),
        )
      }

      if (url.endsWith('/__e2e/files')) {
        return Promise.resolve(
          new Response(
            JSON.stringify({
              ok: true,
              files: [
                {
                  path: 'docs/readme.md',
                  hash: 'hash-1',
                  modifiedAt: 10,
                  size: 42,
                },
              ],
            }),
            { status: 200 },
          ),
        )
      }

      if (url.endsWith('/__e2e/providers')) {
        return Promise.resolve(
          new Response(
            JSON.stringify({ ok: true, providers: [{ id: 'openai', name: 'OpenAI' }] }),
            { status: 200 },
          ),
        )
      }

      if (url.endsWith('/__e2e/agents')) {
        return Promise.resolve(
          new Response(
            JSON.stringify({ ok: true, agents: [{ id: 'assistant', name: 'Assistant' }] }),
            { status: 200 },
          ),
        )
      }

      return Promise.reject(new Error(`unexpected fetch ${method} ${url}`))
    })

    vi.stubGlobal('fetch', mockFetch)

    const { createInstanceClient } = await import('../client')
    const client = await createInstanceClient('alice')

    expect(client).not.toBeNull()
    await expect(client!.session.create({ title: 'Created' })).resolves.toEqual({
      data: {
        id: 'session-2',
        parentID: null,
        time: { created: 3, updated: 4 },
        title: 'Created',
      },
    })
    await expect(client!.session.update({ sessionID: 'session-1', title: 'Renamed' })).resolves.toEqual({
      data: {
        id: 'session-1',
        parentID: null,
        time: { created: 1, updated: 5 },
        title: 'Renamed',
      },
    })
    await expect(client!.session.delete({ sessionID: 'session-1' })).resolves.toEqual({ data: null })
    await expect(client!.session.messages({ sessionID: 'session-1' })).resolves.toEqual({
      data: [
        {
          info: {
            id: 'message-1',
            role: 'user',
            sessionID: 'session-1',
            time: { created: 11 },
          },
          parts: [{ type: 'text', text: 'hello' }],
        },
        {
          info: {
            agent: 'assistant',
            id: 'message-2',
            modelID: 'e2e-model',
            providerID: 'e2e-provider',
            role: 'assistant',
            sessionID: 'session-1',
            time: { created: 12 },
          },
          parts: [{ type: 'text', text: 'world' }],
        },
      ],
    })
    await expect(client!.session.status()).resolves.toEqual({
      data: {
        'session-1': { type: 'busy' },
      },
    })
    await expect(client!.file.list({ path: 'docs' })).resolves.toEqual({
      data: [
        {
          hash: 'hash-1',
          ignored: false,
          modifiedAt: 10,
          name: 'readme.md',
          path: 'docs/readme.md',
          size: 42,
          type: 'file',
        },
      ],
    })
    await expect(client!.config.providers()).resolves.toEqual({
      data: {
        default: { 'e2e-provider': 'e2e-model' },
        providers: [
          {
            id: 'openai',
            models: {
              'e2e-model': {
                cost: { input: 0, output: 0 },
                name: 'E2E Model',
              },
            },
            name: 'OpenAI',
          },
        ],
      },
    })
    await expect(client!.app.agents()).resolves.toEqual({
      data: [{ description: 'Assistant', name: 'assistant' }],
    })
  })
})

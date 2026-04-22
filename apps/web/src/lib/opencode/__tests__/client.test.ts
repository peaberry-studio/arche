import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const mockCreateOpencodeClient = vi.fn()
const mockFindCredentialsBySlug = vi.fn()
const mockDecryptPassword = vi.fn()

function createMockSdkClient(config: {
  baseUrl: string
  fetch?: (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>
}) {
  const requestJson = async (
    path: string,
    options?: {
      body?: unknown
      method?: string
      query?: Record<string, string | number | boolean | undefined>
    },
  ) => {
    const url = new URL(path, config.baseUrl)
    for (const [key, value] of Object.entries(options?.query ?? {})) {
      if (value === undefined) {
        continue
      }
      url.searchParams.set(key, String(value))
    }

    const response = await config.fetch?.(url.toString(), {
      method: options?.method ?? 'GET',
      headers: options?.body ? { 'Content-Type': 'application/json' } : undefined,
      body: options?.body ? JSON.stringify(options.body) : undefined,
    })

    if (!response) {
      throw new Error('missing_mock_fetch')
    }

    if (response.status === 204) {
      return { data: null }
    }

    return { data: await response.json() }
  }

  return {
    app: {
      agents: () => requestJson('/agent'),
    },
    config: {
      providers: () => requestJson('/config/providers'),
    },
    file: {
      list: (parameters?: { path?: string }) => requestJson('/file', { query: { path: parameters?.path ?? '' } }),
      read: (parameters: { path: string }) => requestJson('/file/content', { query: { path: parameters.path } }),
    },
    find: {
      files: (parameters?: { limit?: number; query?: string }) =>
        requestJson('/find/file', { query: { limit: parameters?.limit, query: parameters?.query } }),
    },
    global: {
      health: () => requestJson('/global/health'),
    },
    session: {
      abort: (parameters: { sessionID: string }) =>
        requestJson(`/session/${parameters.sessionID}/abort`, { method: 'POST' }),
      children: (parameters: { sessionID: string }) => requestJson(`/session/${parameters.sessionID}/children`),
      create: (parameters?: { parentID?: string; title?: string }) =>
        requestJson('/session', { method: 'POST', body: parameters }),
      delete: (parameters: { sessionID: string }) =>
        requestJson(`/session/${parameters.sessionID}`, { method: 'DELETE' }),
      diff: (parameters: { messageID?: string; sessionID: string }) =>
        requestJson(`/session/${parameters.sessionID}/diff`, { query: { messageID: parameters.messageID } }),
      get: (parameters: { sessionID: string }) => requestJson(`/session/${parameters.sessionID}`),
      list: (parameters?: { limit?: number; roots?: boolean; start?: number }) =>
        requestJson('/session', {
          query: {
            limit: parameters?.limit,
            roots: parameters?.roots,
            start: parameters?.start,
          },
        }),
      messages: (parameters: { sessionID: string }) => requestJson(`/session/${parameters.sessionID}/message`),
      promptAsync: (parameters: { sessionID: string; [key: string]: unknown }) =>
        requestJson(`/session/${parameters.sessionID}/prompt_async`, { method: 'POST', body: parameters }),
      status: () => requestJson('/session/status'),
      update: (parameters: { sessionID: string; title?: string }) =>
        requestJson(`/session/${parameters.sessionID}`, { method: 'PATCH', body: { title: parameters.title } }),
    },
  }
}

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
    mockCreateOpencodeClient.mockImplementation((config) => createMockSdkClient(config as never))
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

  it('uses the SDK client against the fake runtime in E2E mode', async () => {
    const mockFetch = vi.fn((input: RequestInfo | URL) => {
      const url = String(input)

      if (url.endsWith('/global/health')) {
        return Promise.resolve(
          new Response(JSON.stringify({ healthy: true, version: 'e2e-fake-runtime' }), { status: 200 }),
        )
      }

      if (url.endsWith('/session')) {
        return Promise.resolve(
          new Response(
            JSON.stringify([
              {
                id: 'session-1',
                slug: 'session-1',
                projectID: 'project-e2e',
                directory: '/workspace',
                title: 'Session 1',
                version: 'e2e-fake-runtime',
                time: { created: 1, updated: 2 },
              },
            ]),
            { status: 200 },
          ),
        )
      }

      return Promise.reject(new Error(`unexpected fetch ${url}`))
    })

    vi.stubGlobal('fetch', mockFetch)

    const { createInstanceClient } = await import('../client')
    const client = await createInstanceClient('alice')

    expect(client).not.toBeNull()
    expect(mockCreateOpencodeClient).toHaveBeenCalledTimes(1)
    await expect(client!.global.health()).resolves.toEqual({
      data: { healthy: true, version: 'e2e-fake-runtime' },
    })
    await expect(client!.session.list()).resolves.toEqual({
      data: [
        expect.objectContaining({
          id: 'session-1',
          title: 'Session 1',
          time: { created: 1, updated: 2 },
        }),
      ],
    })
  })

  it('supports the fake runtime server through the real SDK surface', async () => {
    const mockFetch = vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input)
      const method = init?.method ?? 'GET'

      if (url.endsWith('/session') && method === 'POST') {
        return Promise.resolve(
          new Response(
            JSON.stringify({
              id: 'session-2',
              slug: 'session-2',
              projectID: 'project-e2e',
              directory: '/workspace',
              title: 'Created',
              version: 'e2e-fake-runtime',
              time: { created: 3, updated: 4 },
            }),
            { status: 200 },
          ),
        )
      }

      if (url.endsWith('/session/session-1') && method === 'PATCH') {
        return Promise.resolve(
          new Response(
            JSON.stringify({
              id: 'session-1',
              slug: 'session-1',
              projectID: 'project-e2e',
              directory: '/workspace',
              title: 'Renamed',
              version: 'e2e-fake-runtime',
              time: { created: 1, updated: 5 },
            }),
            { status: 200 },
          ),
        )
      }

      if (url.endsWith('/session/session-1') && method === 'DELETE') {
        return Promise.resolve(new Response(JSON.stringify(true), { status: 200 }))
      }

      if (url.endsWith('/session/session-1/children')) {
        return Promise.resolve(new Response(JSON.stringify([]), { status: 200 }))
      }

      if (url.endsWith('/session/session-1/message')) {
        return Promise.resolve(
          new Response(
            JSON.stringify([
              {
                info: {
                  id: 'message-1',
                  role: 'user',
                  sessionID: 'session-1',
                  time: { created: 11 },
                  agent: 'assistant',
                  model: { providerID: 'e2e-provider', modelID: 'e2e-model' },
                },
                parts: [
                  {
                    id: 'part-message-1',
                    sessionID: 'session-1',
                    messageID: 'message-1',
                    type: 'text',
                    text: 'hello',
                  },
                ],
              },
              {
                info: {
                  id: 'message-2',
                  role: 'assistant',
                  sessionID: 'session-1',
                  time: { created: 12, completed: 12 },
                  parentID: 'message-1',
                  modelID: 'e2e-model',
                  providerID: 'e2e-provider',
                  mode: 'primary',
                  agent: 'assistant',
                  path: { cwd: '/workspace', root: '/workspace' },
                  cost: 0,
                  tokens: { input: 0, output: 0, reasoning: 0, cache: { read: 0, write: 0 } },
                },
                parts: [
                  {
                    id: 'part-message-2',
                    sessionID: 'session-1',
                    messageID: 'message-2',
                    type: 'text',
                    text: 'world',
                  },
                ],
              },
            ]),
            { status: 200 },
          ),
        )
      }

      if (url.endsWith('/session/status')) {
        return Promise.resolve(
          new Response(JSON.stringify({ 'session-1': { type: 'busy' } }), { status: 200 }),
        )
      }

      if (url.endsWith('/find/file?query=readme&limit=10') || url.endsWith('/find/file?limit=10&query=readme')) {
        return Promise.resolve(
          new Response(
            JSON.stringify(['docs/readme.md']),
            { status: 200 },
          ),
        )
      }

      if (url.includes('/file?')) {
        return Promise.resolve(
          new Response(
            JSON.stringify([
              {
                absolute: '/workspace/docs/readme.md',
                ignored: false,
                name: 'readme.md',
                path: 'docs/readme.md',
                type: 'file',
              },
            ]),
            { status: 200 },
          ),
        )
      }

      if (url.endsWith('/file/content?path=docs%2Freadme.md')) {
        return Promise.resolve(
          new Response(
            JSON.stringify({ type: 'text', content: 'hello world', mimeType: 'text/markdown' }),
            { status: 200 },
          ),
        )
      }

      if (url.endsWith('/config/providers')) {
        return Promise.resolve(
          new Response(
            JSON.stringify({
              default: { 'e2e-provider': 'e2e-model' },
              providers: [
                {
                  id: 'e2e-provider',
                  name: 'OpenAI',
                  models: {
                    'e2e-model': {
                      cost: { input: 0, output: 0 },
                      name: 'E2E Model',
                    },
                  },
                },
              ],
            }),
            { status: 200 },
          ),
        )
      }

      if (url.endsWith('/agent')) {
        return Promise.resolve(
          new Response(
            JSON.stringify([
              {
                name: 'assistant',
                description: 'Assistant',
                mode: 'primary',
                permission: [],
                options: {},
              },
            ]),
            { status: 200 },
          ),
        )
      }

      if (url.endsWith('/session/session-1/abort') && method === 'POST') {
        return Promise.resolve(new Response(JSON.stringify(true), { status: 200 }))
      }

      if (url.endsWith('/session/session-1/diff')) {
        return Promise.resolve(new Response(JSON.stringify([]), { status: 200 }))
      }

      if (url.endsWith('/session/session-1/prompt_async') && method === 'POST') {
        return Promise.resolve(new Response(null, { status: 204 }))
      }

      return Promise.reject(new Error(`unexpected fetch ${method} ${url}`))
    })

    vi.stubGlobal('fetch', mockFetch)

    const { createInstanceClient } = await import('../client')
    const client = await createInstanceClient('alice')

    expect(client).not.toBeNull()
    expect(mockCreateOpencodeClient).toHaveBeenCalledTimes(1)
    await expect(client!.session.create({ title: 'Created' })).resolves.toEqual({
      data: {
        directory: '/workspace',
        id: 'session-2',
        projectID: 'project-e2e',
        slug: 'session-2',
        time: { created: 3, updated: 4 },
        title: 'Created',
        version: 'e2e-fake-runtime',
      },
    })
    await expect(client!.session.update({ sessionID: 'session-1', title: 'Renamed' })).resolves.toEqual({
      data: {
        directory: '/workspace',
        id: 'session-1',
        projectID: 'project-e2e',
        slug: 'session-1',
        time: { created: 1, updated: 5 },
        title: 'Renamed',
        version: 'e2e-fake-runtime',
      },
    })
    await expect(client!.session.delete({ sessionID: 'session-1' })).resolves.toEqual({ data: true })
    await expect(client!.session.children({ sessionID: 'session-1' })).resolves.toEqual({ data: [] })
    await expect(client!.session.messages({ sessionID: 'session-1' })).resolves.toEqual({
      data: [
        {
          info: {
            agent: 'assistant',
            id: 'message-1',
            model: { modelID: 'e2e-model', providerID: 'e2e-provider' },
            role: 'user',
            sessionID: 'session-1',
            time: { created: 11 },
          },
          parts: [
            expect.objectContaining({
              type: 'text',
              text: 'hello',
            }),
          ],
        },
        {
          info: {
            agent: 'assistant',
            id: 'message-2',
            mode: 'primary',
            modelID: 'e2e-model',
            parentID: 'message-1',
            path: { cwd: '/workspace', root: '/workspace' },
            providerID: 'e2e-provider',
            role: 'assistant',
            sessionID: 'session-1',
            time: { created: 12, completed: 12 },
            cost: 0,
            tokens: { input: 0, output: 0, reasoning: 0, cache: { read: 0, write: 0 } },
          },
          parts: [
            expect.objectContaining({
              type: 'text',
              text: 'world',
            }),
          ],
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
          absolute: '/workspace/docs/readme.md',
          ignored: false,
          name: 'readme.md',
          path: 'docs/readme.md',
          type: 'file',
        },
      ],
    })
    await expect(client!.file.read({ path: 'docs/readme.md' })).resolves.toEqual({
      data: { type: 'text', content: 'hello world', mimeType: 'text/markdown' },
    })
    await expect(client!.find.files({ query: 'readme', limit: 10 })).resolves.toEqual({
      data: ['docs/readme.md'],
    })
    await expect(client!.config.providers()).resolves.toEqual({
      data: {
        default: { 'e2e-provider': 'e2e-model' },
        providers: [
          {
            id: 'e2e-provider',
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
      data: [{ description: 'Assistant', mode: 'primary', name: 'assistant', options: {}, permission: [] }],
    })
    await expect(client!.session.abort({ sessionID: 'session-1' })).resolves.toEqual({ data: true })
    await expect(client!.session.diff({ sessionID: 'session-1' })).resolves.toEqual({ data: [] })
    await expect(client!.session.promptAsync({ sessionID: 'session-1', parts: [] })).resolves.toEqual({ data: null })
  })
})

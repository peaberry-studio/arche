import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  createOllamaProviderSecret: vi.fn(),
  decryptProviderSecret: vi.fn(),
  isOllamaSecret: vi.fn(),
  refreshOllamaProviderSecret: vi.fn(),
}))

vi.mock('@/lib/providers/crypto', () => ({ decryptProviderSecret: mocks.decryptProviderSecret }))
vi.mock('@/lib/providers/ollama', () => ({
  createOllamaProviderSecret: mocks.createOllamaProviderSecret,
  isOllamaSecret: mocks.isOllamaSecret,
  refreshOllamaProviderSecret: mocks.refreshOllamaProviderSecret,
}))

import { getOllamaSecretFromRequest } from '../ollama-credential-request'

const LOCAL_SECRET = {
  baseUrl: 'http://127.0.0.1:11434/v1',
  discoveredAt: '2026-05-27T00:00:00.000Z',
  mode: 'local' as const,
  models: [{ id: 'llama3.2', name: 'llama3.2' }],
}

const REMOTE_SECRET = {
  apiKey: 'remote-token',
  baseUrl: 'https://ollama.example.com/v1',
  discoveredAt: '2026-05-27T00:00:00.000Z',
  mode: 'remote' as const,
  models: [{ id: 'gpt-oss:20b-cloud', name: 'gpt-oss:20b-cloud' }],
}

describe('getOllamaSecretFromRequest', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.createOllamaProviderSecret.mockResolvedValue({ ok: true, secret: LOCAL_SECRET })
    mocks.decryptProviderSecret.mockReturnValue(LOCAL_SECRET)
    mocks.isOllamaSecret.mockReturnValue(true)
    mocks.refreshOllamaProviderSecret.mockResolvedValue({ ok: true, secret: LOCAL_SECRET })
  })

  it('creates a local secret with an optional explicit base URL', async () => {
    const result = await getOllamaSecretFromRequest({
      body: { baseUrl: ' http://localhost:11434/v1 ', mode: 'local' },
      getExistingCredential: vi.fn(),
      providerId: 'ollama',
    })

    expect(result).toEqual({ ok: true, secret: LOCAL_SECRET })
    expect(mocks.createOllamaProviderSecret).toHaveBeenCalledWith({
      baseUrl: 'http://localhost:11434/v1',
      mode: 'local',
    })
  })

  it('creates a remote secret with a trimmed token', async () => {
    mocks.createOllamaProviderSecret.mockResolvedValue({ ok: true, secret: REMOTE_SECRET })

    const result = await getOllamaSecretFromRequest({
      body: { baseUrl: ' https://ollama.example.com/v1 ', mode: 'remote', token: ' remote-token ' },
      getExistingCredential: vi.fn(),
      providerId: 'ollama',
    })

    expect(result).toEqual({ ok: true, secret: REMOTE_SECRET })
    expect(mocks.createOllamaProviderSecret).toHaveBeenCalledWith({
      apiKey: 'remote-token',
      baseUrl: 'https://ollama.example.com/v1',
      mode: 'remote',
    })
  })

  it('maps Ollama discovery errors to route errors', async () => {
    mocks.createOllamaProviderSecret.mockResolvedValue({ ok: false, error: 'blocked_url' })

    const result = await getOllamaSecretFromRequest({
      body: { baseUrl: 'https://127.0.0.1/v1', mode: 'remote', token: 'remote-token' },
      getExistingCredential: vi.fn(),
      providerId: 'ollama',
    })

    expect(result).toEqual({ ok: false, response: { error: 'blocked_endpoint', status: 400 } })
  })

  it('returns missing fields for incomplete remote and unknown modes', async () => {
    await expect(getOllamaSecretFromRequest({
      body: { baseUrl: 'https://ollama.example.com/v1', mode: 'remote' },
      getExistingCredential: vi.fn(),
      providerId: 'ollama',
    })).resolves.toEqual({
      ok: false,
      response: { error: 'missing_fields', message: 'baseUrl and token are required', status: 400 },
    })

    await expect(getOllamaSecretFromRequest({
      body: {},
      getExistingCredential: vi.fn(),
      providerId: 'ollama',
    })).resolves.toEqual({
      ok: false,
      response: { error: 'missing_fields', message: 'mode is required', status: 400 },
    })
  })

  it('refreshes existing Ollama credentials', async () => {
    const getExistingCredential = vi.fn().mockResolvedValue({ secret: 'encrypted-secret' })

    const result = await getOllamaSecretFromRequest({
      body: { refresh: true },
      getExistingCredential,
      providerId: 'ollama',
    })

    expect(result).toEqual({ ok: true, secret: LOCAL_SECRET })
    expect(getExistingCredential).toHaveBeenCalledWith('ollama')
    expect(mocks.decryptProviderSecret).toHaveBeenCalledWith('encrypted-secret')
    expect(mocks.refreshOllamaProviderSecret).toHaveBeenCalledWith(LOCAL_SECRET)
  })

  it('handles refresh credential failures', async () => {
    await expect(getOllamaSecretFromRequest({
      body: { refresh: true },
      getExistingCredential: vi.fn().mockResolvedValue(null),
      providerId: 'ollama',
    })).resolves.toEqual({ ok: false, response: { error: 'missing_credential', status: 404 } })

    mocks.decryptProviderSecret.mockImplementation(() => {
      throw new Error('bad secret')
    })

    await expect(getOllamaSecretFromRequest({
      body: { refresh: true },
      getExistingCredential: vi.fn().mockResolvedValue({ secret: 'encrypted-secret' }),
      providerId: 'ollama',
    })).resolves.toEqual({ ok: false, response: { error: 'invalid_credentials', status: 500 } })
  })

  it('rejects unsupported and undiscoverable refreshed secrets', async () => {
    mocks.isOllamaSecret.mockReturnValueOnce(false)

    await expect(getOllamaSecretFromRequest({
      body: { refresh: true },
      getExistingCredential: vi.fn().mockResolvedValue({ secret: 'encrypted-secret' }),
      providerId: 'ollama',
    })).resolves.toEqual({ ok: false, response: { error: 'unsupported_credential', status: 501 } })

    mocks.refreshOllamaProviderSecret.mockResolvedValue({ ok: false, error: 'unavailable' })

    await expect(getOllamaSecretFromRequest({
      body: { refresh: true },
      getExistingCredential: vi.fn().mockResolvedValue({ secret: 'encrypted-secret' }),
      providerId: 'ollama',
    })).resolves.toEqual({ ok: false, response: { error: 'ollama_discovery_failed', status: 400 } })
  })
})

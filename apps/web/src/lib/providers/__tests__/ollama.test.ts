import { beforeEach, describe, expect, it, vi } from 'vitest'

import {
  createOllamaProviderSecret,
  discoverOllamaLocal,
  discoverOllamaRemote,
  getOllamaBaseUrlFromSecret,
  getOllamaPublicDetails,
  isOllamaSecret,
  refreshOllamaProviderSecret,
  validateOllamaURL,
} from '@/lib/providers/ollama'

const PUBLIC_LOOKUP = vi.fn(async () => [{ address: '203.0.113.10', family: 4 }])

describe('ollama provider helpers', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('discovers local Ollama models through the OpenAI-compatible models endpoint', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ data: [{ id: 'llama3.2' }, { id: 'qwen2.5-coder', name: 'Qwen Coder' }] }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      }),
    )

    const result = await discoverOllamaLocal('http://127.0.0.1:11434/v1', { fetchImpl, timeoutMs: 100 })

    expect(result).toEqual({
      ok: true,
      baseUrl: 'http://127.0.0.1:11434/v1',
      models: [
        { id: 'llama3.2', name: 'llama3.2' },
        { id: 'qwen2.5-coder', name: 'Qwen Coder' },
      ],
    })
    const [, init] = fetchImpl.mock.calls[0] as [string, RequestInit]
    expect(fetchImpl.mock.calls[0]?.[0]).toBe('http://127.0.0.1:11434/v1/models')
    expect(new Headers(init.headers).has('authorization')).toBe(false)
  })

  it('blocks custom local Ollama URLs outside the explicit local allowlist', async () => {
    const fetchImpl = vi.fn()

    await expect(discoverOllamaLocal('http://169.254.169.254/latest/meta-data', { fetchImpl, timeoutMs: 100 }))
      .resolves.toEqual({ ok: false, error: 'blocked_url' })
    await expect(discoverOllamaLocal('http://127.0.0.1:8080/v1', { fetchImpl, timeoutMs: 100 }))
      .resolves.toEqual({ ok: false, error: 'blocked_url' })
    expect(fetchImpl).not.toHaveBeenCalled()
  })

  it('rejects model discovery responses without an OpenAI-compatible data array', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ ok: true }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      }),
    )

    await expect(discoverOllamaLocal('http://127.0.0.1:11434/v1', { fetchImpl, timeoutMs: 100 }))
      .resolves.toEqual({ ok: false, error: 'unavailable' })
  })

  it('validates remote Ollama URLs with HTTPS and SSRF checks', async () => {
    await expect(validateOllamaURL('https://ollama.example.com/v1', { lookupHost: PUBLIC_LOOKUP }))
      .resolves.toEqual({ ok: true, baseUrl: 'https://ollama.example.com/v1' })
    await expect(validateOllamaURL('http://ollama.example.com/v1', { lookupHost: PUBLIC_LOOKUP }))
      .resolves.toEqual({ ok: false, error: 'invalid_url' })
    await expect(validateOllamaURL('https://127.0.0.1:11434/v1', { lookupHost: PUBLIC_LOOKUP }))
      .resolves.toEqual({ ok: false, error: 'blocked_url' })
  })

  it('discovers remote Ollama models with bearer token authentication', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ data: [{ id: 'gpt-oss:20b-cloud' }] }), { status: 200 }),
    )

    const result = await discoverOllamaRemote('https://ollama.example.com/v1', 'ollama-token', {
      fetchImpl,
      lookupHost: PUBLIC_LOOKUP,
      timeoutMs: 100,
    })

    expect(result).toEqual({
      ok: true,
      baseUrl: 'https://ollama.example.com/v1',
      models: [{ id: 'gpt-oss:20b-cloud', name: 'gpt-oss:20b-cloud' }],
    })
    const [, init] = fetchImpl.mock.calls[0] as [string, RequestInit]
    expect(new Headers(init.headers).get('authorization')).toBe('Bearer ollama-token')
  })

  it('does not create a local secret when discovery fails', async () => {
    const fetchImpl = vi.fn().mockRejectedValue(new Error('offline'))

    await expect(createOllamaProviderSecret({ mode: 'local' }, { fetchImpl, timeoutMs: 100 }))
      .resolves.toEqual({ ok: false, error: 'unavailable' })
  })

  it('creates a local secret from an explicit allowed local endpoint', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ data: [{ id: 'llama3.2' }] }), { status: 200 }),
    )

    const result = await createOllamaProviderSecret({
      baseUrl: 'http://localhost:11434/v1',
      mode: 'local',
    }, { fetchImpl, timeoutMs: 100 })

    expect(result).toMatchObject({
      ok: true,
      secret: {
        baseUrl: 'http://localhost:11434/v1',
        mode: 'local',
        models: [{ id: 'llama3.2', name: 'llama3.2' }],
      },
    })
  })

  it('requires a token before remote discovery fetches the endpoint', async () => {
    const fetchImpl = vi.fn()

    await expect(discoverOllamaRemote('https://ollama.example.com/v1', ' ', {
      fetchImpl,
      lookupHost: PUBLIC_LOOKUP,
      timeoutMs: 100,
    })).resolves.toEqual({ ok: false, error: 'missing_token' })
    expect(fetchImpl).not.toHaveBeenCalled()
  })

  it('rejects invalid discovery endpoints before fetching', async () => {
    const fetchImpl = vi.fn()

    await expect(discoverOllamaLocal('not-a-url', { fetchImpl, timeoutMs: 100 }))
      .resolves.toEqual({ ok: false, error: 'invalid_url' })
    await expect(discoverOllamaRemote('http://ollama.example.com/v1', 'remote-token', {
      fetchImpl,
      lookupHost: PUBLIC_LOOKUP,
      timeoutMs: 100,
    })).resolves.toEqual({ ok: false, error: 'invalid_url' })
    expect(fetchImpl).not.toHaveBeenCalled()
  })

  it('creates a remote secret with a normalized base URL and trimmed token', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ data: [{ id: 'gpt-oss:20b-cloud' }] }), { status: 200 }),
    )

    const result = await createOllamaProviderSecret({
      apiKey: ' remote-token ',
      baseUrl: 'https://ollama.example.com/v1?ignored=true#fragment',
      mode: 'remote',
    }, {
      fetchImpl,
      lookupHost: PUBLIC_LOOKUP,
      timeoutMs: 100,
    })

    expect(result).toMatchObject({
      ok: true,
      secret: {
        apiKey: 'remote-token',
        baseUrl: 'https://ollama.example.com/v1',
        mode: 'remote',
        models: [{ id: 'gpt-oss:20b-cloud', name: 'gpt-oss:20b-cloud' }],
      },
    })
    expect(fetchImpl.mock.calls[0]?.[0]).toBe('https://ollama.example.com/v1/models')
  })

  it('refreshes local secrets with newly discovered models', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ data: [{ id: 'llama3.2' }] }), { status: 200 }),
    )

    const result = await refreshOllamaProviderSecret({
      baseUrl: 'http://127.0.0.1:11434/v1',
      discoveredAt: '2026-01-01T00:00:00.000Z',
      mode: 'local',
      models: [{ id: 'old-model', name: 'old-model' }],
    }, { fetchImpl, timeoutMs: 100 })

    expect(result).toMatchObject({
      ok: true,
      secret: {
        baseUrl: 'http://127.0.0.1:11434/v1',
        mode: 'local',
        models: [{ id: 'llama3.2', name: 'llama3.2' }],
      },
    })
  })

  it('refreshes discovered models without changing stored remote credentials', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ data: [{ id: 'qwen3-coder' }] }), { status: 200 }),
    )

    const result = await refreshOllamaProviderSecret({
      apiKey: 'remote-token',
      baseUrl: 'https://ollama.example.com/v1',
      discoveredAt: '2026-01-01T00:00:00.000Z',
      mode: 'remote',
      models: [{ id: 'old-model', name: 'old-model' }],
    }, {
      fetchImpl,
      lookupHost: PUBLIC_LOOKUP,
      timeoutMs: 100,
    })

    expect(result).toMatchObject({
      ok: true,
      secret: {
        apiKey: 'remote-token',
        baseUrl: 'https://ollama.example.com/v1',
        mode: 'remote',
        models: [{ id: 'qwen3-coder', name: 'qwen3-coder' }],
      },
    })
  })

  it('validates Ollama secrets and hides base URLs from public details when requested', () => {
    const secret = {
      apiKey: 'remote-token',
      baseUrl: 'https://ollama.example.com/v1',
      discoveredAt: '2026-01-01T00:00:00.000Z',
      mode: 'remote' as const,
      models: [{ id: 'gpt-oss:20b-cloud', name: 'gpt-oss:20b-cloud' }],
    }

    expect(isOllamaSecret(secret)).toBe(true)
    expect(isOllamaSecret({ ...secret, apiKey: ' ' })).toBe(false)
    expect(isOllamaSecret({ ...secret, mode: 'local', apiKey: 'unexpected-token' })).toBe(false)
    expect(isOllamaSecret({ ...secret, models: [{ id: '', name: 'missing-id' }] })).toBe(false)
    expect(getOllamaPublicDetails(secret, { includeBaseUrl: false })).toEqual({
      discoveredAt: '2026-01-01T00:00:00.000Z',
      mode: 'remote',
      models: [{ id: 'gpt-oss:20b-cloud', name: 'gpt-oss:20b-cloud' }],
    })
    expect(getOllamaBaseUrlFromSecret(secret)).toBe('https://ollama.example.com/v1')
    expect(getOllamaBaseUrlFromSecret({ apiKey: 'plain-secret' })).toBeNull()
    expect(getOllamaPublicDetails({ apiKey: 'plain-secret' })).toBeNull()
  })
})

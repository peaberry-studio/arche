import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  getE2eFakeProviderUrl: vi.fn(),
}))

vi.mock('@/lib/e2e/runtime', () => ({
  getE2eFakeProviderUrl: mocks.getE2eFakeProviderUrl,
}))

import {
  applyProviderAuthHeaders,
  buildUpstreamUrl,
  getProviderGatewayAdapter,
} from '@/lib/providers/gateway-adapters'

describe('provider gateway adapters', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.getE2eFakeProviderUrl.mockReturnValue(null)
  })

  it('normalizes OpenAI responses payloads and retries response calls', () => {
    const adapter = getProviderGatewayAdapter('openai')
    const context = {
      contentType: 'application/json; charset=utf-8',
      method: 'POST',
      pathSegments: ['responses'],
    }

    expect(adapter.authScheme).toBe('bearer')
    expect(adapter.baseUrl()).toBe('https://api.openai.com/v1')
    expect(adapter.extractGatewayToken(new Headers({ authorization: 'Bearer gateway-token ' }))).toBe('gateway-token')
    expect(adapter.shouldNormalizeJsonPayload(context)).toBe(true)
    expect(adapter.maxFetchAttempts(context)).toBe(3)
    expect(adapter.maxFetchAttempts({ ...context, pathSegments: ['chat', 'completions'] })).toBe(1)

    expect(adapter.normalizeJsonPayload({
      reasoning: { effort: 'low', summary: 'auto' },
      reasoning_effort: 'low',
      text: { format: 'plain', verbosity: 'low' },
    }, context)).toEqual({
      reasoning: { effort: 'medium', summary: 'auto' },
      reasoning_effort: 'medium',
      text: { format: 'plain', verbosity: 'medium' },
    })
    expect(adapter.normalizeJsonPayload({ text: { verbosity: 'high' } }, context)).toEqual({ text: { verbosity: 'high' } })
    expect(adapter.normalizeJsonPayload(null, context)).toBeNull()
  })

  it('uses the E2E OpenAI base URL override when present', () => {
    mocks.getE2eFakeProviderUrl.mockReturnValue('http://127.0.0.1:4180/v1')

    expect(getProviderGatewayAdapter('openai').baseUrl()).toBe('http://127.0.0.1:4180/v1')
  })

  it('configures Anthropic x-api-key headers and default version headers', () => {
    const adapter = getProviderGatewayAdapter('anthropic')
    const headers = new Headers()

    expect(adapter.baseUrl()).toBe('https://api.anthropic.com/v1')
    expect(adapter.extractGatewayToken(new Headers({ 'x-api-key': ' anthropic-key ' }))).toBe('anthropic-key')
    expect(applyProviderAuthHeaders(headers, adapter, null)).toBe(false)

    expect(applyProviderAuthHeaders(headers, adapter, 'provider-key')).toBe(true)
    expect(headers.get('x-api-key')).toBe('provider-key')
    expect(headers.get('anthropic-version')).toBe('2023-06-01')
  })

  it('removes unsupported Fireworks display_name payload keys recursively', () => {
    const adapter = getProviderGatewayAdapter('fireworks')
    const context = {
      contentType: 'application/json',
      method: 'POST',
      pathSegments: ['chat', 'completions'],
    }

    const payload = {
      messages: [
        { content: 'hello', display_name: 'User' },
        { nested: { display_name: 'Assistant', value: 1 } },
      ],
      model: 'accounts/fireworks/models/test',
    }

    expect(adapter.shouldNormalizeJsonPayload(context)).toBe(true)
    expect(adapter.normalizeJsonPayload(payload, context)).toEqual({
      messages: [
        { content: 'hello' },
        { nested: { value: 1 } },
      ],
      model: 'accounts/fireworks/models/test',
    })
    expect(adapter.normalizeJsonPayload({ messages: [{ content: 'hello' }] }, context)).toEqual({ messages: [{ content: 'hello' }] })
  })

  it('applies bearer auth headers and supports Opencode x-api-key fallback', () => {
    const openRouter = getProviderGatewayAdapter('openrouter')
    const opencode = getProviderGatewayAdapter('opencode')
    const opencodeGo = getProviderGatewayAdapter('opencode-go')
    const headers = new Headers({ authorization: 'Bearer old-key' })

    expect(openRouter.baseUrl()).toBe('https://openrouter.ai/api/v1')
    expect(applyProviderAuthHeaders(headers, openRouter, null)).toBe(true)
    expect(headers.has('authorization')).toBe(false)
    expect(applyProviderAuthHeaders(headers, openRouter, 'new-key')).toBe(true)
    expect(headers.get('authorization')).toBe('Bearer new-key')

    expect(opencode.baseUrl()).toBe('https://opencode.ai/zen/v1')
    expect(opencode.extractGatewayToken(new Headers({ 'x-api-key': 'gateway-key' }))).toBe('gateway-key')
    expect(opencodeGo.baseUrl()).toBe('https://opencode.ai/zen/go/v1')
  })

  it('uses Ollama credential base URLs and optional bearer auth', () => {
    const ollama = getProviderGatewayAdapter('ollama')
    const localHeaders = new Headers({ authorization: 'Bearer gateway-token' })
    const remoteHeaders = new Headers()

    expect(ollama.baseUrl({
      baseUrl: 'http://host.containers.internal:11434/v1',
      discoveredAt: '2026-01-01T00:00:00.000Z',
      mode: 'local',
      models: [{ id: 'llama3.2', name: 'llama3.2' }],
    })).toBe('http://host.containers.internal:11434/v1')
    expect(applyProviderAuthHeaders(localHeaders, ollama, null)).toBe(true)
    expect(localHeaders.has('authorization')).toBe(false)

    expect(applyProviderAuthHeaders(remoteHeaders, ollama, 'remote-token')).toBe(true)
    expect(remoteHeaders.get('authorization')).toBe('Bearer remote-token')
  })

  it('builds upstream URLs without duplicating the provider v1 prefix', () => {
    const requestUrl = new URL('https://arche.local/api/providers/openai/v1/responses?stream=true')

    expect(buildUpstreamUrl('https://api.openai.com/v1', ['v1', 'responses'], requestUrl))
      .toBe('https://api.openai.com/v1/responses?stream=true')
    expect(buildUpstreamUrl('https://api.openai.com/v1/', 'models', new URL('https://arche.local/api')))
      .toBe('https://api.openai.com/v1/models')
    expect(buildUpstreamUrl('https://api.openai.com/v1', undefined, new URL('https://arche.local/api?limit=1')))
      .toBe('https://api.openai.com/v1?limit=1')
  })
})

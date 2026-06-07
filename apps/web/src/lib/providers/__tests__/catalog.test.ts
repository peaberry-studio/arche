import { describe, expect, it } from 'vitest'

import {
  buildProviderGatewayConfig,
  getCanonicalProviderId,
  getProviderLabel,
  providerRequiresCredential,
  resolveRuntimeProviderId,
  toRuntimeProviderId,
} from '@/lib/providers/catalog'

describe('providers catalog', () => {
  it('normalizes runtime aliases back to canonical provider ids', () => {
    expect(getCanonicalProviderId('fireworks')).toBe('fireworks')
    expect(getCanonicalProviderId('fireworks-ai')).toBe('fireworks')
    expect(getCanonicalProviderId('unknown-provider')).toBeNull()
  })

  it('maps canonical provider ids to the runtime provider ids used by OpenCode', () => {
    expect(toRuntimeProviderId('fireworks')).toBe('fireworks-ai')
    expect(toRuntimeProviderId('huggingface')).toBe('huggingface')
    expect(toRuntimeProviderId('opencode-go')).toBe('opencode-go')
    expect(toRuntimeProviderId('ollama')).toBe('ollama')
    expect(resolveRuntimeProviderId('fireworks')).toBe('fireworks-ai')
    expect(resolveRuntimeProviderId('fireworks-ai')).toBe('fireworks-ai')
    expect(resolveRuntimeProviderId('openai')).toBe('openai')
  })

  it('builds runtime gateway config for both canonical and runtime ids', () => {
    const config = buildProviderGatewayConfig('http://web:3000/api/internal/providers')

    expect(config.provider.fireworks?.options.baseURL).toBe(
      'http://web:3000/api/internal/providers/fireworks',
    )
    expect(config.provider['fireworks-ai']?.options.baseURL).toBe(
      'http://web:3000/api/internal/providers/fireworks',
    )
    expect(config.provider['opencode-go']?.options.baseURL).toBe(
      'http://web:3000/api/internal/providers/opencode-go',
    )
    expect(config.provider.ollama?.options.baseURL).toBe(
      'http://web:3000/api/internal/providers/ollama',
    )
    expect(config.provider.huggingface?.options.baseURL).toBe(
      'http://web:3000/api/internal/providers/huggingface',
    )
    expect(config.provider.ollama?.name).toBe('Ollama')
    expect(config.provider.ollama?.npm).toBe('@ai-sdk/openai-compatible')
    expect(getProviderLabel('fireworks-ai')).toBe('Fireworks AI')
    expect(getProviderLabel('huggingface')).toBe('Hugging Face')
    expect(getProviderLabel('opencode-go')).toBe('OpenCode Go')
    expect(getProviderLabel('ollama')).toBe('Ollama')
  })

  it('declares which providers require managed credentials', () => {
    expect(providerRequiresCredential('openai')).toBe(true)
    expect(providerRequiresCredential('huggingface')).toBe(true)
    expect(providerRequiresCredential('opencode')).toBe(false)
    expect(providerRequiresCredential('opencode-go')).toBe(true)
    expect(providerRequiresCredential('ollama')).toBe(true)
  })
})

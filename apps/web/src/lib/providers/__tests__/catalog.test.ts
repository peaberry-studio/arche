import { describe, expect, it } from 'vitest'

import {
  buildProviderGatewayConfig,
  getCanonicalProviderId,
  getProviderLabel,
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
    expect(getProviderLabel('fireworks-ai')).toBe('Fireworks AI')
  })
})

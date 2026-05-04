import { describe, expect, it } from 'vitest'

import {
  normalizeUmamiBaseUrl,
  parseUmamiConnectorConfig,
  validateUmamiConnectorConfig,
} from '@/lib/connectors/umami'

describe('umami-config', () => {
  it('normalizes cloud and self-hosted base URLs', () => {
    expect(normalizeUmamiBaseUrl('https://api.umami.is', 'api-key')).toBe('https://api.umami.is/v1')
    expect(normalizeUmamiBaseUrl('https://api.umami.is/v1?token=secret#hash', 'api-key')).toBe('https://api.umami.is/v1')
    expect(normalizeUmamiBaseUrl('https://analytics.example.com', 'login')).toBe('https://analytics.example.com/api')
    expect(normalizeUmamiBaseUrl('https://analytics.example.com/custom', 'login')).toBe('https://analytics.example.com/custom/api')
    expect(normalizeUmamiBaseUrl('https://analytics.example.com/custom/api', 'login')).toBe('https://analytics.example.com/custom/api')
  })

  it('rejects invalid or credentialed base URLs', () => {
    expect(() => normalizeUmamiBaseUrl('http://analytics.example.com', 'api-key')).toThrow('Base URL must be a valid HTTPS URL.')
    expect(() => normalizeUmamiBaseUrl('https://user:pass@analytics.example.com', 'login')).toThrow('Base URL cannot include embedded credentials.')
    expect(() => normalizeUmamiBaseUrl('not a url', 'login')).toThrow('Base URL must be a valid HTTPS URL.')
  })

  it('parses API key and login configs', () => {
    expect(parseUmamiConnectorConfig({
      authMethod: 'api-key',
      baseUrl: 'https://api.umami.is',
      apiKey: ' key ',
    })).toEqual({
      ok: true,
      value: {
        authMethod: 'api-key',
        baseUrl: 'https://api.umami.is/v1',
        apiKey: 'key',
      },
    })

    expect(parseUmamiConnectorConfig({
      authMethod: 'login',
      baseUrl: 'https://analytics.example.com',
      username: ' admin ',
      password: ' secret ',
    })).toEqual({
      ok: true,
      value: {
        authMethod: 'login',
        baseUrl: 'https://analytics.example.com/api',
        username: 'admin',
        password: 'secret',
      },
    })
  })

  it('returns validation errors for incomplete configs', () => {
    expect(validateUmamiConnectorConfig({ authMethod: 'api-key' })).toEqual({
      valid: false,
      missing: ['baseUrl'],
      message: undefined,
    })
    expect(validateUmamiConnectorConfig({ authMethod: 'api-key', baseUrl: 'https://api.umami.is' })).toEqual({
      valid: false,
      missing: ['apiKey'],
      message: undefined,
    })
    expect(validateUmamiConnectorConfig({ authMethod: 'login', baseUrl: 'https://analytics.example.com' })).toEqual({
      valid: false,
      missing: ['username', 'password'],
      message: undefined,
    })
    expect(parseUmamiConnectorConfig({
      authMethod: 'login',
      baseUrl: 'https://analytics.example.com',
      username: 'admin',
    })).toEqual({
      ok: false,
      missing: ['password'],
    })
    expect(validateUmamiConnectorConfig({ authMethod: 'other' })).toEqual({
      valid: false,
      missing: undefined,
      message: 'Authentication method must be either api-key or login.',
    })
    expect(validateUmamiConnectorConfig({
      authMethod: 'api-key',
      baseUrl: 'https://api.umami.is',
      apiKey: 'key',
    })).toEqual({ valid: true })
  })
})

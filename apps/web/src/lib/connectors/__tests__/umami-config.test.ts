import { describe, expect, it } from 'vitest'

import { normalizeUmamiBaseUrl, parseUmamiConnectorConfig } from '@/lib/connectors/umami'

describe('umami-config', () => {
  it('defaults self-hosted root URLs to the /api base path', () => {
    expect(normalizeUmamiBaseUrl('https://analytics.example.com/', 'login')).toBe(
      'https://analytics.example.com/api'
    )
  })

  it('defaults cloud root URLs to the /v1 base path', () => {
    expect(normalizeUmamiBaseUrl('https://api.umami.is', 'api-key')).toBe(
      'https://api.umami.is/v1'
    )
  })

  it('parses API key configurations and normalizes the stored base URL', () => {
    expect(
      parseUmamiConnectorConfig({
        authMethod: 'api-key',
        baseUrl: 'https://api.umami.is',
        apiKey: 'key-123',
      })
    ).toEqual({
      ok: true,
      value: {
        authMethod: 'api-key',
        baseUrl: 'https://api.umami.is/v1',
        apiKey: 'key-123',
      },
    })
  })

  it('rejects incomplete login credentials', () => {
    expect(
      parseUmamiConnectorConfig({
        authMethod: 'login',
        baseUrl: 'https://analytics.example.com',
        username: 'admin',
      })
    ).toEqual({
      ok: false,
      missing: ['password'],
    })
  })
})

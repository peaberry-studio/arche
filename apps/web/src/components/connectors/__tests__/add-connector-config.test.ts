import { describe, expect, it } from 'vitest'

import {
  buildConnectorConfig,
  buildDefaultName,
  hasValidHeaders,
  isConnectorConfigurationComplete,
  isStringRecord,
  supportsOAuth,
  type ConnectorFormState,
} from '@/components/connectors/add-connector-config'

function makeState(overrides: Partial<ConnectorFormState> = {}): ConnectorFormState {
  return {
    selectedType: 'linear',
    authType: 'oauth',
    apiKey: '',
    zendeskSubdomain: '',
    zendeskEmail: '',
    umamiAuthMethod: 'api-key',
    umamiBaseUrl: '',
    umamiApiKey: '',
    umamiUsername: '',
    umamiPassword: '',
    endpoint: '',
    auth: '',
    headersText: '',
    oauthScope: '',
    oauthClientId: '',
    oauthClientSecret: '',
    oauthAuthorizationEndpoint: '',
    oauthTokenEndpoint: '',
    oauthRegistrationEndpoint: '',
    linearOAuthActor: 'user',
    linearOAuthScopes: [],
    ...overrides,
  }
}

describe('buildDefaultName', () => {
  it.each([
    ['linear', 'Linear'],
    ['notion', 'Notion'],
    ['zendesk', 'Zendesk'],
    ['ahrefs', 'Ahrefs'],
    ['umami', 'Umami'],
    ['custom', 'Custom Connector'],
  ] as const)('returns default name for %s', (type, expected) => {
    expect(buildDefaultName(type)).toBe(expected)
  })
})

describe('isStringRecord', () => {
  it('returns true for a plain object with string values', () => {
    expect(isStringRecord({ a: '1', b: '2' })).toBe(true)
  })

  it('returns false for arrays', () => {
    expect(isStringRecord(['a'])).toBe(false)
  })

  it('returns false for null', () => {
    expect(isStringRecord(null)).toBe(false)
  })

  it('returns false for objects with non-string values', () => {
    expect(isStringRecord({ a: 1 })).toBe(false)
  })
})

describe('hasValidHeaders', () => {
  it('returns true for empty string', () => {
    expect(hasValidHeaders('')).toBe(true)
  })

  it('returns true for valid JSON object with string values', () => {
    expect(hasValidHeaders('{"x-api-key":"value"}')).toBe(true)
  })

  it('returns false for invalid JSON', () => {
    expect(hasValidHeaders('not json')).toBe(false)
  })

  it('returns false for JSON array', () => {
    expect(hasValidHeaders('["a"]')).toBe(false)
  })
})

describe('supportsOAuth', () => {
  it.each([
    ['linear', true],
    ['notion', true],
    ['custom', true],
    ['zendesk', false],
    ['ahrefs', false],
    ['umami', false],
  ] as const)('supportsOAuth(%s) -> %s', (type, expected) => {
    expect(supportsOAuth(type)).toBe(expected)
  })
})

describe('buildConnectorConfig', () => {
  it('Linear app OAuth incomplete without client credentials', () => {
    const state = makeState({
      selectedType: 'linear',
      authType: 'oauth',
      linearOAuthActor: 'app',
      oauthClientId: '',
      oauthClientSecret: '',
    })
    const result = buildConnectorConfig(state)
    expect(result).toEqual({
      ok: false,
      message: 'Linear app actor OAuth requires client ID and client secret.',
    })
  })

  it('Linear app OAuth complete with client credentials and scopes', () => {
    const state = makeState({
      selectedType: 'linear',
      authType: 'oauth',
      linearOAuthActor: 'app',
      oauthClientId: 'client-id',
      oauthClientSecret: 'client-secret',
      linearOAuthScopes: ['write', 'app:mentionable'],
    })
    const result = buildConnectorConfig(state)
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.value).toEqual({
      authType: 'oauth',
      oauthScope: 'read,write,app:mentionable',
      oauthActor: 'app',
      oauthClientId: 'client-id',
      oauthClientSecret: 'client-secret',
    })
  })

  it('Linear manual requires API key', () => {
    const state = makeState({
      selectedType: 'linear',
      authType: 'manual',
      apiKey: '',
    })
    const result = buildConnectorConfig(state)
    expect(result).toEqual({ ok: false, message: 'API key is required.' })
  })

  it('Linear manual config includes apiKey', () => {
    const state = makeState({
      selectedType: 'linear',
      authType: 'manual',
      apiKey: 'key',
    })
    const result = buildConnectorConfig(state)
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.value).toEqual({ authType: 'manual', apiKey: 'key' })
  })

  it('Custom manual invalid headers returns error', () => {
    const state = makeState({
      selectedType: 'custom',
      authType: 'manual',
      endpoint: 'https://example.com/mcp',
      headersText: 'not json',
    })
    const result = buildConnectorConfig(state)
    expect(result).toEqual({
      ok: false,
      message: 'Headers is not valid JSON.',
    })
  })

  it('Custom manual valid headers are included', () => {
    const state = makeState({
      selectedType: 'custom',
      authType: 'manual',
      endpoint: 'https://example.com/mcp',
      headersText: '{"x-api-key":"value"}',
    })
    const result = buildConnectorConfig(state)
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.value).toEqual({
      authType: 'manual',
      endpoint: 'https://example.com/mcp',
      headers: { 'x-api-key': 'value' },
    })
  })

  it('Zendesk config normalizes subdomain and requires fields', () => {
    const state = makeState({
      selectedType: 'zendesk',
      zendeskSubdomain: 'ACME.zendesk.com',
      zendeskEmail: '',
      apiKey: '',
    })
    expect(buildConnectorConfig(state)).toEqual({
      ok: false,
      message: 'Zendesk agent email is required.',
    })

    const complete = makeState({
      selectedType: 'zendesk',
      zendeskSubdomain: 'ACME.zendesk.com',
      zendeskEmail: 'agent@example.com',
      apiKey: 'token',
    })
    const result = buildConnectorConfig(complete)
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.value).toEqual({
      subdomain: 'acme',
      email: 'agent@example.com',
      apiToken: 'token',
    })
  })

  it('Umami api-key config shape', () => {
    const state = makeState({
      selectedType: 'umami',
      umamiAuthMethod: 'api-key',
      umamiBaseUrl: 'https://api.umami.is/v1',
      umamiApiKey: 'key',
    })
    const result = buildConnectorConfig(state)
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.value).toEqual({
      authMethod: 'api-key',
      baseUrl: 'https://api.umami.is/v1',
      apiKey: 'key',
    })
  })

  it('Umami login config shape', () => {
    const state = makeState({
      selectedType: 'umami',
      umamiAuthMethod: 'login',
      umamiBaseUrl: 'https://analytics.example.com',
      umamiUsername: 'admin',
      umamiPassword: 'secret',
    })
    const result = buildConnectorConfig(state)
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.value).toEqual({
      authMethod: 'login',
      baseUrl: 'https://analytics.example.com',
      username: 'admin',
      password: 'secret',
    })
  })
})

describe('isConnectorConfigurationComplete', () => {
  it('custom without name is incomplete', () => {
    const state = makeState({
      selectedType: 'custom',
      authType: 'manual',
      endpoint: 'https://example.com',
    })
    expect(isConnectorConfigurationComplete(state, '')).toBe(false)
    expect(isConnectorConfigurationComplete(state, 'My Connector')).toBe(true)
  })

  it('custom oauth requires endpoint', () => {
    const state = makeState({
      selectedType: 'custom',
      authType: 'oauth',
      endpoint: '',
    })
    expect(isConnectorConfigurationComplete(state, 'Name')).toBe(false)
  })

  it('custom manual requires endpoint and valid headers', () => {
    const state = makeState({
      selectedType: 'custom',
      authType: 'manual',
      endpoint: 'https://example.com',
      headersText: 'bad',
    })
    expect(isConnectorConfigurationComplete(state, 'Name')).toBe(false)

    const valid = makeState({
      selectedType: 'custom',
      authType: 'manual',
      endpoint: 'https://example.com',
      headersText: '{"ok":"yes"}',
    })
    expect(isConnectorConfigurationComplete(valid, 'Name')).toBe(true)
  })

  it('linear app oauth requires client id and secret', () => {
    const state = makeState({
      selectedType: 'linear',
      authType: 'oauth',
      linearOAuthActor: 'app',
      oauthClientId: '',
      oauthClientSecret: '',
    })
    expect(isConnectorConfigurationComplete(state, '')).toBe(false)

    const complete = makeState({
      selectedType: 'linear',
      authType: 'oauth',
      linearOAuthActor: 'app',
      oauthClientId: 'id',
      oauthClientSecret: 'secret',
    })
    expect(isConnectorConfigurationComplete(complete, '')).toBe(true)
  })

  it('linear user oauth is complete without credentials', () => {
    const state = makeState({
      selectedType: 'linear',
      authType: 'oauth',
      linearOAuthActor: 'user',
    })
    expect(isConnectorConfigurationComplete(state, '')).toBe(true)
  })

  it('notion oauth is complete', () => {
    const state = makeState({
      selectedType: 'notion',
      authType: 'oauth',
    })
    expect(isConnectorConfigurationComplete(state, '')).toBe(true)
  })

  it('ahrefs requires api key', () => {
    const state = makeState({ selectedType: 'ahrefs', apiKey: '' })
    expect(isConnectorConfigurationComplete(state, '')).toBe(false)

    const complete = makeState({ selectedType: 'ahrefs', apiKey: 'key' })
    expect(isConnectorConfigurationComplete(complete, '')).toBe(true)
  })

  it('zendesk requires subdomain, email, and token', () => {
    const state = makeState({
      selectedType: 'zendesk',
      zendeskSubdomain: 'acme',
      zendeskEmail: '',
      apiKey: '',
    })
    expect(isConnectorConfigurationComplete(state, '')).toBe(false)

    const complete = makeState({
      selectedType: 'zendesk',
      zendeskSubdomain: 'acme',
      zendeskEmail: 'a@b.com',
      apiKey: 't',
    })
    expect(isConnectorConfigurationComplete(complete, '')).toBe(true)
  })

  it('umami api-key requires base url and api key', () => {
    const state = makeState({
      selectedType: 'umami',
      umamiAuthMethod: 'api-key',
      umamiBaseUrl: '',
      umamiApiKey: '',
    })
    expect(isConnectorConfigurationComplete(state, '')).toBe(false)

    const complete = makeState({
      selectedType: 'umami',
      umamiAuthMethod: 'api-key',
      umamiBaseUrl: 'https://api.umami.is/v1',
      umamiApiKey: 'k',
    })
    expect(isConnectorConfigurationComplete(complete, '')).toBe(true)
  })

  it('umami login requires base url, username, and password', () => {
    const state = makeState({
      selectedType: 'umami',
      umamiAuthMethod: 'login',
      umamiBaseUrl: 'https://example.com',
      umamiUsername: '',
      umamiPassword: '',
    })
    expect(isConnectorConfigurationComplete(state, '')).toBe(false)

    const complete = makeState({
      selectedType: 'umami',
      umamiAuthMethod: 'login',
      umamiBaseUrl: 'https://example.com',
      umamiUsername: 'u',
      umamiPassword: 'p',
    })
    expect(isConnectorConfigurationComplete(complete, '')).toBe(true)
  })
})

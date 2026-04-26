import { describe, expect, it } from 'vitest'

import {
  buildConnectorConfig,
  buildDefaultName,
  getDefaultAuthType,
  hasValidHeaders,
  isConnectorConfigurationComplete,
  isStringRecord,
  supportsOAuth,
  type ConnectorFormState,
} from '@/components/connectors/add-connector-config'

describe('buildDefaultName', () => {
  it.each([
    ['linear', 'Linear'],
    ['notion', 'Notion'],
    ['zendesk', 'Zendesk'],
    ['ahrefs', 'Ahrefs'],
    ['umami', 'Umami'],
    ['google_gmail', 'Gmail'],
    ['google_drive', 'Google Drive'],
    ['google_calendar', 'Google Calendar'],
    ['google_chat', 'Google Chat'],
    ['google_people', 'People API'],
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
    ['google_gmail', true],
    ['google_drive', true],
    ['google_calendar', true],
    ['google_chat', true],
    ['google_people', true],
    ['zendesk', false],
    ['ahrefs', false],
    ['umami', false],
  ] as const)('supportsOAuth(%s) -> %s', (type, expected) => {
    expect(supportsOAuth(type)).toBe(expected)
  })
})

describe('getDefaultAuthType', () => {
  it.each([
    ['linear', 'oauth'],
    ['notion', 'oauth'],
    ['google_gmail', 'oauth'],
    ['google_drive', 'oauth'],
    ['google_calendar', 'oauth'],
    ['google_chat', 'oauth'],
    ['google_people', 'oauth'],
    ['zendesk', 'manual'],
    ['ahrefs', 'manual'],
    ['umami', 'manual'],
    ['custom', 'manual'],
  ] as const)('returns %s for %s', (type, expected) => {
    expect(getDefaultAuthType(type)).toBe(expected)
  })
})

describe('buildConnectorConfig', () => {
  it('Linear app OAuth incomplete without client credentials', () => {
    const state: ConnectorFormState = {
      selectedType: 'linear',
      authType: 'oauth',
      linearOAuthActor: 'app',
      linearOAuthScopes: [],
      oauthClientId: '',
      oauthClientSecret: '',
    }
    const result = buildConnectorConfig(state)
    expect(result).toEqual({
      ok: false,
      message: 'Linear app actor OAuth requires client ID and client secret.',
    })
  })

  it('Linear app OAuth complete with client credentials and scopes', () => {
    const state: ConnectorFormState = {
      selectedType: 'linear',
      authType: 'oauth',
      linearOAuthActor: 'app',
      oauthClientId: 'client-id',
      oauthClientSecret: 'client-secret',
      linearOAuthScopes: ['write', 'app:mentionable'],
    }
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
    const state: ConnectorFormState = {
      selectedType: 'linear',
      authType: 'manual',
      apiKey: '',
    }
    const result = buildConnectorConfig(state)
    expect(result).toEqual({ ok: false, message: 'API key is required.' })
  })

  it('Linear manual config includes apiKey', () => {
    const state: ConnectorFormState = {
      selectedType: 'linear',
      authType: 'manual',
      apiKey: 'key',
    }
    const result = buildConnectorConfig(state)
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.value).toEqual({ authType: 'manual', apiKey: 'key' })
  })

  it('Linear user OAuth with write scope produces read,write', () => {
    const state: ConnectorFormState = {
      selectedType: 'linear',
      authType: 'oauth',
      linearOAuthActor: 'user',
      linearOAuthScopes: ['write'],
      oauthClientId: '',
      oauthClientSecret: '',
    }
    const result = buildConnectorConfig(state)
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.value).toEqual({
      authType: 'oauth',
      oauthScope: 'read,write',
    })
  })

  it('Custom manual invalid headers returns error', () => {
    const state: ConnectorFormState = {
      selectedType: 'custom',
      authType: 'manual',
      name: 'Test',
      endpoint: 'https://example.com/mcp',
      auth: '',
      headersText: 'not json',
    }
    const result = buildConnectorConfig(state)
    expect(result).toEqual({
      ok: false,
      message: 'Headers is not valid JSON.',
    })
  })

  it('Custom manual valid headers are included', () => {
    const state: ConnectorFormState = {
      selectedType: 'custom',
      authType: 'manual',
      name: 'Test',
      endpoint: 'https://example.com/mcp',
      auth: '',
      headersText: '{"x-api-key":"value"}',
    }
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
    const incomplete: ConnectorFormState = {
      selectedType: 'zendesk',
      zendeskSubdomain: 'ACME.zendesk.com',
      zendeskEmail: '',
      apiToken: '',
    }
    expect(buildConnectorConfig(incomplete)).toEqual({
      ok: false,
      message: 'Zendesk agent email is required.',
    })

    const complete: ConnectorFormState = {
      selectedType: 'zendesk',
      zendeskSubdomain: 'ACME.zendesk.com',
      zendeskEmail: 'agent@example.com',
      apiToken: 'token',
    }
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
    const state: ConnectorFormState = {
      selectedType: 'umami',
      umamiAuthMethod: 'api-key',
      umamiBaseUrl: 'https://api.umami.is/v1',
      umamiApiKey: 'key',
    }
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
    const state: ConnectorFormState = {
      selectedType: 'umami',
      umamiAuthMethod: 'login',
      umamiBaseUrl: 'https://analytics.example.com',
      umamiUsername: 'admin',
      umamiPassword: 'secret',
    }
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

  it('Google Gmail OAuth config shape', () => {
    const state: ConnectorFormState = {
      selectedType: 'google_gmail',
      authType: 'oauth',
    }
    const result = buildConnectorConfig(state)
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.value).toEqual({ authType: 'oauth' })
  })

  it('Google Drive OAuth config shape', () => {
    const state: ConnectorFormState = {
      selectedType: 'google_drive',
      authType: 'oauth',
    }
    const result = buildConnectorConfig(state)
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.value).toEqual({ authType: 'oauth' })
  })
})

describe('isConnectorConfigurationComplete', () => {
  it('custom without name is incomplete', () => {
    const state: ConnectorFormState = {
      selectedType: 'custom',
      authType: 'manual',
      name: '',
      endpoint: 'https://example.com',
      auth: '',
      headersText: '',
    }
    expect(isConnectorConfigurationComplete(state)).toBe(false)

    const named: ConnectorFormState = {
      selectedType: 'custom',
      authType: 'manual',
      name: 'My Connector',
      endpoint: 'https://example.com',
      auth: '',
      headersText: '',
    }
    expect(isConnectorConfigurationComplete(named)).toBe(true)
  })

  it('custom oauth requires endpoint', () => {
    const state: ConnectorFormState = {
      selectedType: 'custom',
      authType: 'oauth',
      name: 'Name',
      endpoint: '',
      oauthScope: '',
      oauthClientId: '',
      oauthClientSecret: '',
      oauthAuthorizationEndpoint: '',
      oauthTokenEndpoint: '',
      oauthRegistrationEndpoint: '',
    }
    expect(isConnectorConfigurationComplete(state)).toBe(false)
  })

  it('custom manual requires endpoint and valid headers', () => {
    const state: ConnectorFormState = {
      selectedType: 'custom',
      authType: 'manual',
      name: 'Name',
      endpoint: 'https://example.com',
      auth: '',
      headersText: 'bad',
    }
    expect(isConnectorConfigurationComplete(state)).toBe(false)

    const valid: ConnectorFormState = {
      selectedType: 'custom',
      authType: 'manual',
      name: 'Name',
      endpoint: 'https://example.com',
      auth: '',
      headersText: '{"ok":"yes"}',
    }
    expect(isConnectorConfigurationComplete(valid)).toBe(true)
  })

  it('linear app oauth requires client id and secret', () => {
    const state: ConnectorFormState = {
      selectedType: 'linear',
      authType: 'oauth',
      linearOAuthActor: 'app',
      linearOAuthScopes: [],
      oauthClientId: '',
      oauthClientSecret: '',
    }
    expect(isConnectorConfigurationComplete(state)).toBe(false)

    const complete: ConnectorFormState = {
      selectedType: 'linear',
      authType: 'oauth',
      linearOAuthActor: 'app',
      linearOAuthScopes: [],
      oauthClientId: 'id',
      oauthClientSecret: 'secret',
    }
    expect(isConnectorConfigurationComplete(complete)).toBe(true)
  })

  it('linear user oauth is complete without credentials', () => {
    const state: ConnectorFormState = {
      selectedType: 'linear',
      authType: 'oauth',
      linearOAuthActor: 'user',
      linearOAuthScopes: [],
      oauthClientId: '',
      oauthClientSecret: '',
    }
    expect(isConnectorConfigurationComplete(state)).toBe(true)
  })

  it('notion oauth is complete', () => {
    const state: ConnectorFormState = {
      selectedType: 'notion',
      authType: 'oauth',
    }
    expect(isConnectorConfigurationComplete(state)).toBe(true)
  })

  it('ahrefs requires api key', () => {
    const state: ConnectorFormState = { selectedType: 'ahrefs', apiKey: '' }
    expect(isConnectorConfigurationComplete(state)).toBe(false)

    const complete: ConnectorFormState = { selectedType: 'ahrefs', apiKey: 'key' }
    expect(isConnectorConfigurationComplete(complete)).toBe(true)
  })

  it('zendesk requires subdomain, email, and token', () => {
    const state: ConnectorFormState = {
      selectedType: 'zendesk',
      zendeskSubdomain: 'acme',
      zendeskEmail: '',
      apiToken: '',
    }
    expect(isConnectorConfigurationComplete(state)).toBe(false)

    const complete: ConnectorFormState = {
      selectedType: 'zendesk',
      zendeskSubdomain: 'acme',
      zendeskEmail: 'a@b.com',
      apiToken: 't',
    }
    expect(isConnectorConfigurationComplete(complete)).toBe(true)
  })

  it('umami api-key requires base url and api key', () => {
    const state: ConnectorFormState = {
      selectedType: 'umami',
      umamiAuthMethod: 'api-key',
      umamiBaseUrl: '',
      umamiApiKey: '',
    }
    expect(isConnectorConfigurationComplete(state)).toBe(false)

    const complete: ConnectorFormState = {
      selectedType: 'umami',
      umamiAuthMethod: 'api-key',
      umamiBaseUrl: 'https://api.umami.is/v1',
      umamiApiKey: 'k',
    }
    expect(isConnectorConfigurationComplete(complete)).toBe(true)
  })

  it('umami login requires base url, username, and password', () => {
    const state: ConnectorFormState = {
      selectedType: 'umami',
      umamiAuthMethod: 'login',
      umamiBaseUrl: 'https://example.com',
      umamiUsername: '',
      umamiPassword: '',
    }
    expect(isConnectorConfigurationComplete(state)).toBe(false)

    const complete: ConnectorFormState = {
      selectedType: 'umami',
      umamiAuthMethod: 'login',
      umamiBaseUrl: 'https://example.com',
      umamiUsername: 'u',
      umamiPassword: 'p',
    }
    expect(isConnectorConfigurationComplete(complete)).toBe(true)
  })

  it('google workspace oauth is complete', () => {
    const gmail: ConnectorFormState = {
      selectedType: 'google_gmail',
      authType: 'oauth',
    }
    expect(isConnectorConfigurationComplete(gmail)).toBe(true)

    const drive: ConnectorFormState = {
      selectedType: 'google_drive',
      authType: 'oauth',
    }
    expect(isConnectorConfigurationComplete(drive)).toBe(true)

    const calendar: ConnectorFormState = {
      selectedType: 'google_calendar',
      authType: 'oauth',
    }
    expect(isConnectorConfigurationComplete(calendar)).toBe(true)

    const chat: ConnectorFormState = {
      selectedType: 'google_chat',
      authType: 'oauth',
    }
    expect(isConnectorConfigurationComplete(chat)).toBe(true)

    const people: ConnectorFormState = {
      selectedType: 'google_people',
      authType: 'oauth',
    }
    expect(isConnectorConfigurationComplete(people)).toBe(true)
  })
})

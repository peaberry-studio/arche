import { describe, expect, it } from 'vitest'

import {
  buildCustomConnectorConfig,
  isCustomConnectorConfigurationComplete,
  type CustomConnectorFormState,
} from '@/components/connectors/add-connector/custom/config'
import {
  buildGoogleWorkspaceConnectorConfig,
  isGoogleWorkspaceConnectorConfigurationComplete,
} from '@/components/connectors/add-connector/google-workspace/config'
import {
  buildLinearConnectorConfig,
  isLinearConnectorConfigurationComplete,
  type LinearConnectorFormState,
} from '@/components/connectors/add-connector/linear/config'
import {
  buildMetaAdsConnectorConfig,
  isMetaAdsConnectorConfigurationComplete,
} from '@/components/connectors/add-connector/meta-ads/config'
import {
  buildNotionConnectorConfig,
  isNotionConnectorConfigurationComplete,
  type NotionConnectorFormState,
} from '@/components/connectors/add-connector/notion/config'
import {
  buildUmamiConnectorConfig,
  isUmamiConnectorConfigurationComplete,
  type UmamiConnectorFormState,
} from '@/components/connectors/add-connector/umami/config'
import {
  buildZendeskConnectorConfig,
  isZendeskConnectorConfigurationComplete,
} from '@/components/connectors/add-connector/zendesk/config'

describe('add connector config builders', () => {
  it('builds custom manual and OAuth connector config', () => {
    const manualState: CustomConnectorFormState = {
      selectedType: 'custom',
      authType: 'manual',
      name: 'Custom API',
      endpoint: ' https://api.example.com ',
      auth: ' token ',
      headersText: '{"X-Team":"growth"}',
    }

    expect(buildCustomConnectorConfig(manualState)).toEqual({
      ok: true,
      value: {
        authType: 'manual',
        endpoint: 'https://api.example.com',
        auth: 'token',
        headers: { 'X-Team': 'growth' },
      },
    })
    expect(isCustomConnectorConfigurationComplete(manualState)).toBe(true)

    const oauthState: CustomConnectorFormState = {
      selectedType: 'custom',
      authType: 'oauth',
      name: 'OAuth API',
      endpoint: ' https://oauth.example.com ',
      oauthScope: ' read write ',
      oauthClientId: ' client-id ',
      oauthClientSecret: '',
      oauthAuthorizationEndpoint: ' https://auth.example.com ',
      oauthTokenEndpoint: ' https://token.example.com ',
      oauthRegistrationEndpoint: '',
    }

    expect(buildCustomConnectorConfig(oauthState)).toEqual({
      ok: true,
      value: {
        authType: 'oauth',
        endpoint: 'https://oauth.example.com',
        oauthScope: 'read write',
        oauthClientId: 'client-id',
        oauthClientSecret: undefined,
        oauthAuthorizationEndpoint: 'https://auth.example.com',
        oauthTokenEndpoint: 'https://token.example.com',
        oauthRegistrationEndpoint: undefined,
      },
    })
  })

  it('validates custom connector required fields and headers', () => {
    const base: CustomConnectorFormState = {
      selectedType: 'custom',
      authType: 'manual',
      name: 'Custom API',
      endpoint: '',
      auth: '',
      headersText: '',
    }

    expect(buildCustomConnectorConfig(base)).toEqual({ ok: false, message: 'Endpoint is required.' })
    expect(isCustomConnectorConfigurationComplete(base)).toBe(false)
    expect(buildCustomConnectorConfig({ ...base, endpoint: 'https://api.example.com', headersText: '[]' })).toEqual({
      ok: false,
      message: 'Headers must be a JSON object with string values.',
    })
    expect(buildCustomConnectorConfig({ ...base, endpoint: 'https://api.example.com', headersText: '{bad' })).toEqual({
      ok: false,
      message: 'Headers is not valid JSON.',
    })
  })

  it('builds Umami connector config for both auth methods', () => {
    const apiKeyState: UmamiConnectorFormState = {
      selectedType: 'umami',
      umamiAuthMethod: 'api-key',
      umamiBaseUrl: ' https://umami.example.com ',
      umamiApiKey: ' key ',
    }
    const loginState: UmamiConnectorFormState = {
      selectedType: 'umami',
      umamiAuthMethod: 'login',
      umamiBaseUrl: ' https://umami.example.com ',
      umamiUsername: ' user@example.com ',
      umamiPassword: ' secret ',
    }

    expect(buildUmamiConnectorConfig(apiKeyState)).toEqual({
      ok: true,
      value: { authMethod: 'api-key', baseUrl: 'https://umami.example.com', apiKey: 'key' },
    })
    expect(buildUmamiConnectorConfig(loginState)).toEqual({
      ok: true,
      value: {
        authMethod: 'login',
        baseUrl: 'https://umami.example.com',
        username: 'user@example.com',
        password: 'secret',
      },
    })
    expect(isUmamiConnectorConfigurationComplete(apiKeyState)).toBe(true)
    expect(isUmamiConnectorConfigurationComplete(loginState)).toBe(true)
  })

  it('validates Umami required fields', () => {
    expect(buildUmamiConnectorConfig({
      selectedType: 'umami',
      umamiAuthMethod: 'api-key',
      umamiBaseUrl: '',
      umamiApiKey: '',
    })).toEqual({ ok: false, message: 'Umami base URL is required.' })
    expect(buildUmamiConnectorConfig({
      selectedType: 'umami',
      umamiAuthMethod: 'api-key',
      umamiBaseUrl: 'https://umami.example.com',
      umamiApiKey: '',
    })).toEqual({ ok: false, message: 'Umami API key is required.' })
    expect(buildUmamiConnectorConfig({
      selectedType: 'umami',
      umamiAuthMethod: 'login',
      umamiBaseUrl: 'https://umami.example.com',
      umamiUsername: '',
      umamiPassword: '',
    })).toEqual({ ok: false, message: 'Umami username is required.' })
    expect(buildUmamiConnectorConfig({
      selectedType: 'umami',
      umamiAuthMethod: 'login',
      umamiBaseUrl: 'https://umami.example.com',
      umamiUsername: 'user@example.com',
      umamiPassword: '',
    })).toEqual({ ok: false, message: 'Umami password is required.' })
  })

  it('builds OAuth and manual config for built-in connector types', () => {
    const notionManual: NotionConnectorFormState = {
      selectedType: 'notion',
      authType: 'manual',
      apiKey: ' notion-secret ',
    }
    const linearManual: LinearConnectorFormState = {
      selectedType: 'linear',
      authType: 'manual',
      apiKey: ' linear-key ',
    }

    expect(buildNotionConnectorConfig({ selectedType: 'notion', authType: 'oauth' })).toEqual({
      ok: true,
      value: { authType: 'oauth' },
    })
    expect(buildNotionConnectorConfig(notionManual)).toEqual({
      ok: true,
      value: { authType: 'manual', apiKey: 'notion-secret' },
    })
    expect(isNotionConnectorConfigurationComplete(notionManual)).toBe(true)
    expect(buildLinearConnectorConfig({
      selectedType: 'linear',
      authType: 'oauth',
      linearOAuthActor: 'user',
      linearOAuthScopes: ['write'],
      oauthClientId: '',
      oauthClientSecret: '',
    })).toEqual({
      ok: true,
      value: { authType: 'oauth', oauthScope: 'read,write' },
    })
    expect(buildLinearConnectorConfig(linearManual)).toEqual({
      ok: true,
      value: { authType: 'manual', apiKey: 'linear-key' },
    })
    expect(isLinearConnectorConfigurationComplete(linearManual)).toBe(true)
  })

  it('validates Linear and Notion required fields', () => {
    expect(buildNotionConnectorConfig({ selectedType: 'notion', authType: 'manual', apiKey: '' })).toEqual({
      ok: false,
      message: 'API key is required.',
    })
    expect(isNotionConnectorConfigurationComplete({ selectedType: 'notion', authType: 'manual', apiKey: '' })).toBe(false)
    expect(buildLinearConnectorConfig({ selectedType: 'linear', authType: 'manual', apiKey: '' })).toEqual({
      ok: false,
      message: 'API key is required.',
    })
    expect(buildLinearConnectorConfig({
      selectedType: 'linear',
      authType: 'oauth',
      linearOAuthActor: 'app',
      linearOAuthScopes: [],
      oauthClientId: '',
      oauthClientSecret: '',
    })).toEqual({
      ok: false,
      message: 'Linear app actor OAuth requires client ID and client secret.',
    })
  })

  it('builds and validates Meta Ads, Google Workspace, and Zendesk config', () => {
    expect(buildMetaAdsConnectorConfig({ selectedType: 'meta-ads', appId: '', appSecret: '' })).toEqual({
      ok: false,
      message: 'Meta Ads App ID is required.',
    })
    expect(buildMetaAdsConnectorConfig({ selectedType: 'meta-ads', appId: ' app ', appSecret: '' })).toEqual({
      ok: false,
      message: 'Meta Ads App Secret is required.',
    })
    expect(buildMetaAdsConnectorConfig({ selectedType: 'meta-ads', appId: ' app ', appSecret: ' secret ' })).toMatchObject({
      ok: true,
      value: { authType: 'oauth', appId: 'app', appSecret: 'secret', selectedAdAccountIds: [] },
    })
    expect(isMetaAdsConnectorConfigurationComplete({ selectedType: 'meta-ads', appId: 'app', appSecret: 'secret' })).toBe(true)
    expect(buildGoogleWorkspaceConnectorConfig({ selectedType: 'google_drive', authType: 'oauth' })).toEqual({
      ok: true,
      value: { authType: 'oauth' },
    })
    expect(isGoogleWorkspaceConnectorConfigurationComplete({ selectedType: 'google_drive', authType: 'oauth' })).toBe(true)
    expect(buildZendeskConnectorConfig({ selectedType: 'zendesk', zendeskSubdomain: '', zendeskEmail: '', apiToken: '' })).toEqual({
      ok: false,
      message: 'Zendesk subdomain is required.',
    })
    expect(buildZendeskConnectorConfig({ selectedType: 'zendesk', zendeskSubdomain: 'acme', zendeskEmail: '', apiToken: '' })).toEqual({
      ok: false,
      message: 'Zendesk agent email is required.',
    })
    expect(buildZendeskConnectorConfig({ selectedType: 'zendesk', zendeskSubdomain: 'acme', zendeskEmail: 'agent@example.com', apiToken: '' })).toEqual({
      ok: false,
      message: 'Zendesk API token is required.',
    })
    expect(buildZendeskConnectorConfig({ selectedType: 'zendesk', zendeskSubdomain: ' https://acme.zendesk.com ', zendeskEmail: ' agent@example.com ', apiToken: ' token ' })).toEqual({
      ok: true,
      value: { subdomain: 'acme', email: 'agent@example.com', apiToken: 'token' },
    })
    expect(isZendeskConnectorConfigurationComplete({ selectedType: 'zendesk', zendeskSubdomain: 'acme', zendeskEmail: 'agent@example.com', apiToken: 'token' })).toBe(true)
  })
})

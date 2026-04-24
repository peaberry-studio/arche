import {
  buildLinearOAuthScope,
  type LinearOAuthActor,
  type LinearOptionalOAuthScope,
} from '@/lib/connectors/linear'
import {
  CONNECTOR_TYPES,
  OAUTH_CONNECTOR_TYPES,
  type ConnectorAuthType,
  type ConnectorType,
} from '@/lib/connectors/types'
import { normalizeZendeskSubdomain } from '@/lib/connectors/zendesk-shared'

export const CONNECTOR_TYPE_OPTIONS: {
  type: ConnectorType
  label: string
  description: string
}[] = [
  {
    type: 'linear',
    label: 'Linear',
    description: 'Official Linear MCP integration.',
  },
  {
    type: 'notion',
    label: 'Notion',
    description: 'Official Notion MCP integration.',
  },
  {
    type: 'zendesk',
    label: 'Zendesk',
    description: 'Zendesk Ticketing API via Arche MCP.',
  },
  {
    type: 'ahrefs',
    label: 'Ahrefs',
    description: 'Ahrefs SEO data via Arche MCP.',
  },
  {
    type: 'umami',
    label: 'Umami',
    description:
      'Website analytics from Umami Cloud or self-hosted Umami.',
  },
  {
    type: 'custom',
    label: 'Custom',
    description: 'Any compatible remote MCP endpoint.',
  },
]

export const DEFAULT_TYPE: ConnectorType = CONNECTOR_TYPES[0]
export const DEFAULT_LINEAR_OAUTH_ACTOR: LinearOAuthActor = 'user'

export type ConnectorFormState = {
  selectedType: ConnectorType
  authType: ConnectorAuthType
  apiKey: string
  zendeskSubdomain: string
  zendeskEmail: string
  umamiAuthMethod: 'api-key' | 'login'
  umamiBaseUrl: string
  umamiApiKey: string
  umamiUsername: string
  umamiPassword: string
  endpoint: string
  auth: string
  headersText: string
  oauthScope: string
  oauthClientId: string
  oauthClientSecret: string
  oauthAuthorizationEndpoint: string
  oauthTokenEndpoint: string
  oauthRegistrationEndpoint: string
  linearOAuthActor: LinearOAuthActor
  linearOAuthScopes: LinearOptionalOAuthScope[]
}

export function buildDefaultName(type: ConnectorType): string {
  switch (type) {
    case 'linear':
      return 'Linear'
    case 'notion':
      return 'Notion'
    case 'zendesk':
      return 'Zendesk'
    case 'ahrefs':
      return 'Ahrefs'
    case 'umami':
      return 'Umami'
    case 'custom':
      return 'Custom Connector'
  }
}

export function isStringRecord(value: unknown): value is Record<string, string> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false
  for (const entry of Object.values(value)) {
    if (typeof entry !== 'string') return false
  }
  return true
}

export function hasValidHeaders(headersText: string): boolean {
  if (!headersText.trim()) return true
  try {
    const parsed = JSON.parse(headersText) as unknown
    return isStringRecord(parsed)
  } catch {
    return false
  }
}

export function supportsOAuth(type: ConnectorType): boolean {
  return OAUTH_CONNECTOR_TYPES.includes(
    type as (typeof OAUTH_CONNECTOR_TYPES)[number]
  )
}

export function getDefaultAuthType(type: ConnectorType): ConnectorAuthType {
  return type === 'linear' || type === 'notion' ? 'oauth' : 'manual'
}

export function buildConnectorConfig(
  state: ConnectorFormState
):
  | { ok: true; value: Record<string, unknown> }
  | { ok: false; message: string } {
  const {
    selectedType,
    authType,
    apiKey,
    zendeskSubdomain,
    zendeskEmail,
    umamiAuthMethod,
    umamiBaseUrl,
    umamiApiKey,
    umamiUsername,
    umamiPassword,
    endpoint,
    auth,
    headersText,
    oauthScope,
    oauthClientId,
    oauthClientSecret,
    oauthAuthorizationEndpoint,
    oauthTokenEndpoint,
    oauthRegistrationEndpoint,
    linearOAuthActor,
    linearOAuthScopes,
  } = state

  if (selectedType === 'linear' || selectedType === 'notion') {
    if (authType === 'oauth') {
      if (selectedType === 'linear' && linearOAuthActor === 'app') {
        if (!oauthClientId.trim() || !oauthClientSecret.trim()) {
          return {
            ok: false,
            message:
              'Linear app actor OAuth requires client ID and client secret.',
          }
        }
      }

      return {
        ok: true,
        value: {
          authType: 'oauth',
          ...(selectedType === 'linear'
            ? {
                oauthScope: buildLinearOAuthScope(linearOAuthScopes),
              }
            : {}),
          ...(selectedType === 'linear' && linearOAuthActor === 'app'
            ? {
                oauthActor: 'app',
                oauthClientId: oauthClientId.trim() || undefined,
                oauthClientSecret: oauthClientSecret.trim() || undefined,
              }
            : {}),
        },
      }
    }
    if (!apiKey.trim()) {
      return { ok: false, message: 'API key is required.' }
    }
    return {
      ok: true,
      value: { authType: 'manual', apiKey: apiKey.trim() },
    }
  }

  if (selectedType === 'zendesk') {
    if (!zendeskSubdomain.trim()) {
      return { ok: false, message: 'Zendesk subdomain is required.' }
    }

    if (!zendeskEmail.trim()) {
      return { ok: false, message: 'Zendesk agent email is required.' }
    }

    if (!apiKey.trim()) {
      return { ok: false, message: 'Zendesk API token is required.' }
    }

    return {
      ok: true,
      value: {
        subdomain: normalizeZendeskSubdomain(zendeskSubdomain),
        email: zendeskEmail.trim(),
        apiToken: apiKey.trim(),
      },
    }
  }

  if (selectedType === 'ahrefs') {
    if (!apiKey.trim()) {
      return { ok: false, message: 'Ahrefs API key is required.' }
    }

    return {
      ok: true,
      value: {
        apiKey: apiKey.trim(),
      },
    }
  }

  if (selectedType === 'umami') {
    if (!umamiBaseUrl.trim()) {
      return { ok: false, message: 'Umami base URL is required.' }
    }

    if (umamiAuthMethod === 'api-key') {
      if (!umamiApiKey.trim()) {
        return { ok: false, message: 'Umami API key is required.' }
      }

      return {
        ok: true,
        value: {
          authMethod: 'api-key',
          baseUrl: umamiBaseUrl.trim(),
          apiKey: umamiApiKey.trim(),
        },
      }
    }

    if (!umamiUsername.trim()) {
      return { ok: false, message: 'Umami username is required.' }
    }

    if (!umamiPassword.trim()) {
      return { ok: false, message: 'Umami password is required.' }
    }

    return {
      ok: true,
      value: {
        authMethod: 'login',
        baseUrl: umamiBaseUrl.trim(),
        username: umamiUsername.trim(),
        password: umamiPassword.trim(),
      },
    }
  }

  if (selectedType === 'custom') {
    if (!endpoint.trim()) {
      return { ok: false, message: 'Endpoint is required.' }
    }

    if (authType === 'oauth') {
      return {
        ok: true,
        value: {
          authType: 'oauth',
          endpoint: endpoint.trim(),
          oauthScope: oauthScope.trim() || undefined,
          oauthClientId: oauthClientId.trim() || undefined,
          oauthClientSecret: oauthClientSecret.trim() || undefined,
          oauthAuthorizationEndpoint:
            oauthAuthorizationEndpoint.trim() || undefined,
          oauthTokenEndpoint: oauthTokenEndpoint.trim() || undefined,
          oauthRegistrationEndpoint:
            oauthRegistrationEndpoint.trim() || undefined,
        },
      }
    }

    if (!headersText.trim()) {
      return {
        ok: true,
        value: {
          authType: 'manual',
          endpoint: endpoint.trim(),
          auth: auth.trim() || undefined,
        },
      }
    }

    try {
      const parsed = JSON.parse(headersText) as unknown
      if (!isStringRecord(parsed)) {
        return {
          ok: false,
          message: 'Headers must be a JSON object with string values.',
        }
      }

      return {
        ok: true,
        value: {
          authType: 'manual',
          endpoint: endpoint.trim(),
          auth: auth.trim() || undefined,
          headers: parsed,
        },
      }
    } catch {
      return { ok: false, message: 'Headers is not valid JSON.' }
    }
  }

  return { ok: false, message: 'Unsupported connector type.' }
}

export function isConnectorConfigurationComplete(
  state: ConnectorFormState,
  name: string
): boolean {
  const {
    selectedType,
    authType,
    apiKey,
    zendeskSubdomain,
    zendeskEmail,
    umamiAuthMethod,
    umamiBaseUrl,
    umamiApiKey,
    umamiUsername,
    umamiPassword,
    endpoint,
    headersText,
    oauthClientId,
    oauthClientSecret,
    linearOAuthActor,
  } = state

  if (selectedType === 'custom' && !name.trim()) return false

  if (selectedType === 'zendesk') {
    return Boolean(
      zendeskSubdomain.trim() && zendeskEmail.trim() && apiKey.trim()
    )
  }

  if (selectedType === 'ahrefs') {
    return Boolean(apiKey.trim())
  }

  if (selectedType === 'umami') {
    if (umamiAuthMethod === 'api-key') {
      return Boolean(umamiBaseUrl.trim() && umamiApiKey.trim())
    }

    return Boolean(
      umamiBaseUrl.trim() && umamiUsername.trim() && umamiPassword.trim()
    )
  }

  if (selectedType === 'custom') {
    if (authType === 'oauth') {
      return Boolean(endpoint.trim())
    }

    return Boolean(endpoint.trim() && hasValidHeaders(headersText))
  }

  if (selectedType === 'linear' || selectedType === 'notion') {
    if (
      selectedType === 'linear' &&
      authType === 'oauth' &&
      linearOAuthActor === 'app'
    ) {
      return Boolean(oauthClientId.trim() && oauthClientSecret.trim())
    }

    return authType === 'oauth' || Boolean(apiKey.trim())
  }

  return false
}

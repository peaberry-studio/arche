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

export type LinearConnectorFormState =
  | {
      selectedType: 'linear'
      authType: 'oauth'
      linearOAuthActor: LinearOAuthActor
      linearOAuthScopes: LinearOptionalOAuthScope[]
      oauthClientId: string
      oauthClientSecret: string
    }
  | { selectedType: 'linear'; authType: 'manual'; apiKey: string }

export type NotionConnectorFormState =
  | { selectedType: 'notion'; authType: 'oauth' }
  | { selectedType: 'notion'; authType: 'manual'; apiKey: string }

export type ZendeskConnectorFormState = {
  selectedType: 'zendesk'
  zendeskSubdomain: string
  zendeskEmail: string
  apiToken: string
}

export type AhrefsConnectorFormState = {
  selectedType: 'ahrefs'
  apiKey: string
}

export type UmamiConnectorFormState =
  | {
      selectedType: 'umami'
      umamiAuthMethod: 'api-key'
      umamiBaseUrl: string
      umamiApiKey: string
    }
  | {
      selectedType: 'umami'
      umamiAuthMethod: 'login'
      umamiBaseUrl: string
      umamiUsername: string
      umamiPassword: string
    }

export type CustomConnectorFormState =
  | {
      selectedType: 'custom'
      authType: 'manual'
      name: string
      endpoint: string
      auth: string
      headersText: string
    }
  | {
      selectedType: 'custom'
      authType: 'oauth'
      name: string
      endpoint: string
      oauthScope: string
      oauthClientId: string
      oauthClientSecret: string
      oauthAuthorizationEndpoint: string
      oauthTokenEndpoint: string
      oauthRegistrationEndpoint: string
    }

export type ConnectorFormState =
  | LinearConnectorFormState
  | NotionConnectorFormState
  | ZendeskConnectorFormState
  | AhrefsConnectorFormState
  | UmamiConnectorFormState
  | CustomConnectorFormState

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
  return (OAUTH_CONNECTOR_TYPES as readonly ConnectorType[]).includes(type)
}

export function getDefaultAuthType(type: ConnectorType): ConnectorAuthType {
  return type === 'linear' || type === 'notion' ? 'oauth' : 'manual'
}

export function buildConnectorConfig(
  state: ConnectorFormState
):
  | { ok: true; value: Record<string, unknown> }
  | { ok: false; message: string } {
  switch (state.selectedType) {
    case 'linear': {
      if (state.authType === 'oauth') {
        if (state.linearOAuthActor === 'app') {
          if (!state.oauthClientId.trim() || !state.oauthClientSecret.trim()) {
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
            oauthScope: buildLinearOAuthScope(state.linearOAuthScopes),
            ...(state.linearOAuthActor === 'app'
              ? {
                  oauthActor: 'app',
                  oauthClientId: state.oauthClientId.trim() || undefined,
                  oauthClientSecret: state.oauthClientSecret.trim() || undefined,
                }
              : {}),
          },
        }
      }

      if (!state.apiKey.trim()) {
        return { ok: false, message: 'API key is required.' }
      }
      return {
        ok: true,
        value: { authType: 'manual', apiKey: state.apiKey.trim() },
      }
    }

    case 'notion': {
      if (state.authType === 'oauth') {
        return {
          ok: true,
          value: { authType: 'oauth' },
        }
      }

      if (!state.apiKey.trim()) {
        return { ok: false, message: 'API key is required.' }
      }
      return {
        ok: true,
        value: { authType: 'manual', apiKey: state.apiKey.trim() },
      }
    }

    case 'zendesk': {
      if (!state.zendeskSubdomain.trim()) {
        return { ok: false, message: 'Zendesk subdomain is required.' }
      }

      if (!state.zendeskEmail.trim()) {
        return { ok: false, message: 'Zendesk agent email is required.' }
      }

      if (!state.apiToken.trim()) {
        return { ok: false, message: 'Zendesk API token is required.' }
      }

      return {
        ok: true,
        value: {
          subdomain: normalizeZendeskSubdomain(state.zendeskSubdomain),
          email: state.zendeskEmail.trim(),
          apiToken: state.apiToken.trim(),
        },
      }
    }

    case 'ahrefs': {
      if (!state.apiKey.trim()) {
        return { ok: false, message: 'Ahrefs API key is required.' }
      }

      return {
        ok: true,
        value: {
          apiKey: state.apiKey.trim(),
        },
      }
    }

    case 'umami': {
      if (!state.umamiBaseUrl.trim()) {
        return { ok: false, message: 'Umami base URL is required.' }
      }

      if (state.umamiAuthMethod === 'api-key') {
        if (!state.umamiApiKey.trim()) {
          return { ok: false, message: 'Umami API key is required.' }
        }

        return {
          ok: true,
          value: {
            authMethod: 'api-key',
            baseUrl: state.umamiBaseUrl.trim(),
            apiKey: state.umamiApiKey.trim(),
          },
        }
      }

      if (!state.umamiUsername.trim()) {
        return { ok: false, message: 'Umami username is required.' }
      }

      if (!state.umamiPassword.trim()) {
        return { ok: false, message: 'Umami password is required.' }
      }

      return {
        ok: true,
        value: {
          authMethod: 'login',
          baseUrl: state.umamiBaseUrl.trim(),
          username: state.umamiUsername.trim(),
          password: state.umamiPassword.trim(),
        },
      }
    }

    case 'custom': {
      if (!state.endpoint.trim()) {
        return { ok: false, message: 'Endpoint is required.' }
      }

      if (state.authType === 'oauth') {
        return {
          ok: true,
          value: {
            authType: 'oauth',
            endpoint: state.endpoint.trim(),
            oauthScope: state.oauthScope.trim() || undefined,
            oauthClientId: state.oauthClientId.trim() || undefined,
            oauthClientSecret: state.oauthClientSecret.trim() || undefined,
            oauthAuthorizationEndpoint:
              state.oauthAuthorizationEndpoint.trim() || undefined,
            oauthTokenEndpoint: state.oauthTokenEndpoint.trim() || undefined,
            oauthRegistrationEndpoint:
              state.oauthRegistrationEndpoint.trim() || undefined,
          },
        }
      }

      if (!state.headersText.trim()) {
        return {
          ok: true,
          value: {
            authType: 'manual',
            endpoint: state.endpoint.trim(),
            auth: state.auth.trim() || undefined,
          },
        }
      }

      try {
        const parsed = JSON.parse(state.headersText) as unknown
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
            endpoint: state.endpoint.trim(),
            auth: state.auth.trim() || undefined,
            headers: parsed,
          },
        }
      } catch {
        return { ok: false, message: 'Headers is not valid JSON.' }
      }
    }
  }
}

export function isConnectorConfigurationComplete(
  state: ConnectorFormState
): boolean {
  switch (state.selectedType) {
    case 'linear': {
      if (
        state.authType === 'oauth' &&
        state.linearOAuthActor === 'app'
      ) {
        return Boolean(state.oauthClientId.trim() && state.oauthClientSecret.trim())
      }
      return state.authType === 'oauth' ? true : Boolean(state.apiKey.trim())
    }

    case 'notion': {
      return state.authType === 'oauth' ? true : Boolean(state.apiKey.trim())
    }

    case 'zendesk': {
      return Boolean(
        state.zendeskSubdomain.trim() && state.zendeskEmail.trim() && state.apiToken.trim()
      )
    }

    case 'ahrefs': {
      return Boolean(state.apiKey.trim())
    }

    case 'umami': {
      if (state.umamiAuthMethod === 'api-key') {
        return Boolean(state.umamiBaseUrl.trim() && state.umamiApiKey.trim())
      }
      return Boolean(
        state.umamiBaseUrl.trim() && state.umamiUsername.trim() && state.umamiPassword.trim()
      )
    }

    case 'custom': {
      if (!state.name.trim()) return false

      if (state.authType === 'oauth') {
        return Boolean(state.endpoint.trim())
      }

      return Boolean(state.endpoint.trim() && hasValidHeaders(state.headersText))
    }
  }
}

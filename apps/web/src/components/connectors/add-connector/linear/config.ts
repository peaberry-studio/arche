import {
  buildLinearOAuthScope,
  type LinearOAuthActor,
  type LinearOptionalOAuthScope,
} from '@/lib/connectors/linear'

import type { ConnectorConfigResult } from '@/components/connectors/add-connector/types'

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

export function buildLinearConnectorConfig(
  state: LinearConnectorFormState
): ConnectorConfigResult {
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

export function isLinearConnectorConfigurationComplete(
  state: LinearConnectorFormState
): boolean {
  if (
    state.authType === 'oauth' &&
    state.linearOAuthActor === 'app'
  ) {
    return Boolean(state.oauthClientId.trim() && state.oauthClientSecret.trim())
  }
  return state.authType === 'oauth' ? true : Boolean(state.apiKey.trim())
}

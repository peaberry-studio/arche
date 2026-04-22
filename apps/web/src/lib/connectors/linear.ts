export const LINEAR_OAUTH_ACTORS = ['user', 'app'] as const

export type LinearOAuthActor = (typeof LINEAR_OAUTH_ACTORS)[number]

type LinearOAuthClientRegistration = {
  clientId: string
  clientSecret?: string
}

function getString(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value.trim() : undefined
}

export function isLinearOAuthActor(value: unknown): value is LinearOAuthActor {
  return LINEAR_OAUTH_ACTORS.includes(value as LinearOAuthActor)
}

export function getLinearOAuthActor(config: Record<string, unknown>): LinearOAuthActor {
  return isLinearOAuthActor(config.oauthActor) ? config.oauthActor : 'user'
}

export function getLinearOAuthClientRegistration(
  config: Record<string, unknown>
): LinearOAuthClientRegistration | null {
  const clientId = getString(config.oauthClientId)
  if (!clientId) return null

  return {
    clientId,
    clientSecret: getString(config.oauthClientSecret),
  }
}

export function resolveLinearOAuthActor(
  connectorType: string,
  authType: 'manual' | 'oauth',
  config: Record<string, unknown>
): LinearOAuthActor | undefined {
  return connectorType === 'linear' && authType === 'oauth' ? getLinearOAuthActor(config) : undefined
}

export function getLinearOAuthModeLabel(connector: {
  type: string
  authType: 'manual' | 'oauth'
  oauthActor?: LinearOAuthActor
}): string | null {
  if (connector.type !== 'linear' || connector.authType !== 'oauth') {
    return null
  }

  return connector.oauthActor === 'app' ? 'App actor OAuth' : 'User OAuth'
}

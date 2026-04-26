export const LINEAR_OAUTH_ACTORS = ['user', 'app'] as const

export type LinearOAuthActor = (typeof LINEAR_OAUTH_ACTORS)[number]
export const LINEAR_READ_OAUTH_SCOPE = 'read'

export const LINEAR_OAUTH_SCOPE_OPTIONS = [
  {
    scope: 'write',
    label: 'Write access',
    description: 'Create and update workspace data.',
    actors: LINEAR_OAUTH_ACTORS,
  },
  {
    scope: 'issues:create',
    label: 'Create issues',
    description: 'Allow creating issues and attachments.',
    actors: LINEAR_OAUTH_ACTORS,
  },
  {
    scope: 'comments:create',
    label: 'Create comments',
    description: 'Allow posting issue comments.',
    actors: LINEAR_OAUTH_ACTORS,
  },
  {
    scope: 'timeSchedule:write',
    label: 'Manage schedules',
    description: 'Allow creating and editing time schedules.',
    actors: LINEAR_OAUTH_ACTORS,
  },
  {
    scope: 'admin',
    label: 'Admin access',
    description: 'Request full admin access. Only use when absolutely necessary.',
    actors: ['user'],
  },
  {
    scope: 'app:assignable',
    label: 'Assignable app',
    description: 'Allow the app to be delegated on issues and added to projects.',
    actors: ['app'],
  },
  {
    scope: 'app:mentionable',
    label: 'Mentionable app',
    description: 'Allow mentioning the app in issues, docs, and editors.',
    actors: ['app'],
  },
  {
    scope: 'customer:read',
    label: 'Read customers',
    description: 'Allow reading customer data.',
    actors: ['app'],
  },
  {
    scope: 'customer:write',
    label: 'Write customers',
    description: 'Allow creating and updating customer data.',
    actors: ['app'],
  },
  {
    scope: 'initiative:read',
    label: 'Read initiatives',
    description: 'Allow reading initiative data.',
    actors: ['app'],
  },
  {
    scope: 'initiative:write',
    label: 'Write initiatives',
    description: 'Allow creating and updating initiative data.',
    actors: ['app'],
  },
] as const

export type LinearOptionalOAuthScope = (typeof LINEAR_OAUTH_SCOPE_OPTIONS)[number]['scope']

type LinearOAuthClientCredentials = {
  clientId: string
  clientSecret: string
}

function getString(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value.trim() : undefined
}

function splitLinearOAuthScope(value: string): string[] {
  return value
    .split(/[\s,]+/)
    .map((scope) => scope.trim())
    .filter(Boolean)
}

export function isLinearOAuthActor(value: unknown): value is LinearOAuthActor {
  return LINEAR_OAUTH_ACTORS.includes(value as LinearOAuthActor)
}

export function isLinearOptionalOAuthScope(value: unknown): value is LinearOptionalOAuthScope {
  return LINEAR_OAUTH_SCOPE_OPTIONS.some((option) => option.scope === value)
}

export function getLinearOAuthActor(config: Record<string, unknown>): LinearOAuthActor {
  return isLinearOAuthActor(config.oauthActor) ? config.oauthActor : 'user'
}

export function isLinearOAuthScopeAllowedForActor(
  scope: LinearOptionalOAuthScope,
  actor: LinearOAuthActor,
): boolean {
  const option = LINEAR_OAUTH_SCOPE_OPTIONS.find((entry) => entry.scope === scope)
  return option ? option.actors.some((supportedActor) => supportedActor === actor) : false
}

export function parseLinearOptionalOAuthScopes(value: unknown): LinearOptionalOAuthScope[] {
  if (typeof value !== 'string' || !value.trim()) {
    return []
  }

  const scopes: LinearOptionalOAuthScope[] = []
  for (const scope of splitLinearOAuthScope(value)) {
    if (
      scope === LINEAR_READ_OAUTH_SCOPE
      || !isLinearOptionalOAuthScope(scope)
      || scopes.includes(scope)
    ) {
      continue
    }

    scopes.push(scope)
  }

  return scopes
}

export function buildLinearOAuthScope(scopes: readonly LinearOptionalOAuthScope[]): string {
  const normalizedScopes = parseLinearOptionalOAuthScopes(scopes.join(','))
  return [LINEAR_READ_OAUTH_SCOPE, ...normalizedScopes].join(',')
}

export function getLinearOAuthScopeValidationError(
  value: unknown,
  actor: LinearOAuthActor,
): string | undefined {
  if (value === undefined) {
    return undefined
  }

  if (typeof value !== 'string' || !value.trim()) {
    return 'Linear OAuth scope must be a non-empty string'
  }

  for (const scope of splitLinearOAuthScope(value)) {
    if (scope === LINEAR_READ_OAUTH_SCOPE) {
      continue
    }

    if (!isLinearOptionalOAuthScope(scope)) {
      return 'Linear OAuth scope contains unsupported permissions'
    }

    if (!isLinearOAuthScopeAllowedForActor(scope, actor)) {
      if (actor === 'app' && scope === 'admin') {
        return 'Linear app actor OAuth cannot request admin scope'
      }

      return actor === 'app'
        ? 'Linear app actor OAuth scope contains unsupported permissions'
        : 'Linear user OAuth cannot request app-only permissions'
    }
  }

  return undefined
}

export function getLinearOAuthClientCredentials(
  config: Record<string, unknown>
): LinearOAuthClientCredentials | null {
  const clientId = getString(config.oauthClientId)
  const clientSecret = getString(config.oauthClientSecret)
  if (!clientId || !clientSecret) return null

  return {
    clientId,
    clientSecret,
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

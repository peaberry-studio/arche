export const LINEAR_OAUTH_ACTORS = ['user', 'app'] as const

export type LinearOAuthActor = (typeof LINEAR_OAUTH_ACTORS)[number]

export function isLinearOAuthActor(value: unknown): value is LinearOAuthActor {
  return LINEAR_OAUTH_ACTORS.includes(value as LinearOAuthActor)
}

export function getLinearOAuthActor(config: Record<string, unknown>): LinearOAuthActor {
  return isLinearOAuthActor(config.oauthActor) ? config.oauthActor : 'user'
}

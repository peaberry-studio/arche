export const PROVIDERS = ['openai', 'anthropic', 'fireworks', 'openrouter', 'opencode'] as const
export type ProviderId = (typeof PROVIDERS)[number]

const RUNTIME_PROVIDER_ID_ALIASES: Partial<Record<ProviderId, string>> = {
  fireworks: 'fireworks-ai',
}

export function toRuntimeProviderId(providerId: ProviderId): string {
  return RUNTIME_PROVIDER_ID_ALIASES[providerId] ?? providerId
}

export type ProviderCredentialType = 'api'

export type ApiSecret = { apiKey: string }
export type ProviderSecret = ApiSecret

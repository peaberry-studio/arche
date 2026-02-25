export const PROVIDERS = ['openai', 'anthropic', 'openrouter', 'opencode'] as const
export type ProviderId = (typeof PROVIDERS)[number]

export type ProviderCredentialType = 'api'

export type ApiSecret = { apiKey: string }
export type ProviderSecret = ApiSecret

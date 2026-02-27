export const PROVIDERS = ['openai', 'anthropic', 'openrouter', 'opencode'] as const
export type ProviderId = (typeof PROVIDERS)[number]

export const CREDENTIAL_REQUIRED_PROVIDER_IDS: ReadonlyArray<ProviderId> = [
  'openai',
  'anthropic',
  'openrouter',
]

export type ProviderCredentialType = 'api'

export type ApiSecret = { apiKey: string }
export type ProviderSecret = ApiSecret

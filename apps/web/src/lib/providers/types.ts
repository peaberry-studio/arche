export const PROVIDERS = ['openai', 'anthropic', 'openrouter', 'opencode'] as const
export type ProviderId = (typeof PROVIDERS)[number]

export const CREDENTIAL_REQUIRED_PROVIDER_IDS: ReadonlyArray<ProviderId> = [
  'openai',
  'anthropic',
  'openrouter',
]

export function isProviderId(value: string): value is ProviderId {
  return PROVIDERS.some((id) => id === value)
}

/** Gateway token version used when no Arche-managed credential exists for OpenCode. */
export const OPENCODE_PUBLIC_VERSION = 0 as const

/** API key sentinel sent to upstream OpenCode Zen for public/free-tier access. */
export const OPENCODE_PUBLIC_API_KEY = 'public' as const

export type ProviderCredentialType = 'api'

export type ApiSecret = { apiKey: string }
export type ProviderSecret = ApiSecret

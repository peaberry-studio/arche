import { isRecord } from '@/lib/records'

export const PROVIDERS = [
  'openai',
  'anthropic',
  'fireworks',
  'huggingface',
  'openrouter',
  'zai',
  'opencode',
  'opencode-go',
  'ollama',
] as const
export type ProviderId = (typeof PROVIDERS)[number]

export type ProviderCredentialType = 'api'

export type ApiSecret = { apiKey: string }
export type OllamaMode = 'local' | 'remote'
export type OllamaDiscoveredModel = { id: string; name: string }

type OllamaSecretBase = {
  /** OpenAI-compatible base URL discovered or validated by Arche. */
  baseUrl: string
  /** ISO timestamp for the last successful model discovery. */
  discoveredAt: string
  models: OllamaDiscoveredModel[]
}

/** Local Ollama is reached by the Arche server and does not forward upstream auth. */
export type OllamaLocalSecret = OllamaSecretBase & { mode: 'local' }
/** Remote Ollama requires a stored bearer token that stays inside the BFF. */
export type OllamaRemoteSecret = OllamaSecretBase & { apiKey: string; mode: 'remote' }
export type OllamaSecret = OllamaLocalSecret | OllamaRemoteSecret
export type ProviderSecret = ApiSecret | OllamaSecret

export function isPlainApiSecret(secret: unknown): secret is ApiSecret {
  return (
    isRecord(secret) &&
    Object.keys(secret).length === 1 &&
    typeof secret.apiKey === 'string'
  )
}

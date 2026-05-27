export const PROVIDERS = [
  'openai',
  'anthropic',
  'fireworks',
  'openrouter',
  'opencode',
  'opencode-go',
  'ollama',
] as const
export type ProviderId = (typeof PROVIDERS)[number]

export type ProviderCredentialType = 'api'

export type ApiSecret = { apiKey: string }
export type OllamaMode = 'local' | 'remote'
export type OllamaDiscoveredModel = { id: string; name: string }
export type OllamaSecret = {
  apiKey?: string
  baseUrl: string
  discoveredAt: string
  mode: OllamaMode
  models: OllamaDiscoveredModel[]
}
export type ProviderSecret = ApiSecret | OllamaSecret

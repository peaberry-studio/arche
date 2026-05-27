import { PROVIDERS, type ProviderId } from '@/lib/providers/types'

type ProviderMetadata = {
  label: string
  requiresCredential: boolean
  runtimeConfig?: Omit<ProviderRuntimeConfig, 'options'>
  runtimeId: string
  gatewayPath: ProviderId
}

type ProviderRuntimeConfig = {
  models?: Record<string, { name?: string }>
  name?: string
  npm?: string
  options: {
    baseURL: string
  }
}

const PROVIDER_METADATA: Record<ProviderId, ProviderMetadata> = {
  openai: {
    label: 'OpenAI',
    requiresCredential: true,
    runtimeId: 'openai',
    gatewayPath: 'openai',
  },
  anthropic: {
    label: 'Anthropic',
    requiresCredential: true,
    runtimeId: 'anthropic',
    gatewayPath: 'anthropic',
  },
  fireworks: {
    label: 'Fireworks AI',
    requiresCredential: true,
    runtimeId: 'fireworks-ai',
    gatewayPath: 'fireworks',
  },
  openrouter: {
    label: 'OpenRouter',
    requiresCredential: true,
    runtimeId: 'openrouter',
    gatewayPath: 'openrouter',
  },
  opencode: {
    label: 'OpenCode Zen',
    requiresCredential: false,
    runtimeId: 'opencode',
    gatewayPath: 'opencode',
  },
  'opencode-go': {
    label: 'OpenCode Go',
    requiresCredential: true,
    runtimeId: 'opencode-go',
    gatewayPath: 'opencode-go',
  },
  ollama: {
    label: 'Ollama',
    requiresCredential: true,
    runtimeConfig: { name: 'Ollama', npm: '@ai-sdk/openai-compatible' },
    runtimeId: 'ollama',
    gatewayPath: 'ollama',
  },
}

const PROVIDER_ID_ALIASES: Record<string, ProviderId> = {
  'fireworks-ai': 'fireworks',
}

const CANONICAL_PROVIDER_IDS = new Set<string>(PROVIDERS)

function getRuntimeConfigProviderIds(providerId: ProviderId): string[] {
  const runtimeId = toRuntimeProviderId(providerId)
  return runtimeId === providerId ? [providerId] : [providerId, runtimeId]
}

export function isProviderId(value: string): value is ProviderId {
  return CANONICAL_PROVIDER_IDS.has(value)
}

export function getCanonicalProviderId(providerId: string): ProviderId | null {
  if (isProviderId(providerId)) {
    return providerId
  }

  return PROVIDER_ID_ALIASES[providerId] ?? null
}

export function normalizeProviderId(providerId: string): string {
  return getCanonicalProviderId(providerId) ?? providerId
}

export function toRuntimeProviderId(providerId: ProviderId): string {
  return PROVIDER_METADATA[providerId].runtimeId
}

export function resolveRuntimeProviderId(providerId: string): string {
  const canonicalProviderId = getCanonicalProviderId(providerId)
  if (!canonicalProviderId) {
    return providerId
  }

  return toRuntimeProviderId(canonicalProviderId)
}

export function getProviderLabel(providerId: string): string {
  const canonicalProviderId = getCanonicalProviderId(providerId)
  if (!canonicalProviderId) {
    return providerId
  }

  return PROVIDER_METADATA[canonicalProviderId].label
}

export function getProviderGatewayPath(providerId: ProviderId): ProviderId {
  return PROVIDER_METADATA[providerId].gatewayPath
}

export function providerRequiresCredential(providerId: ProviderId): boolean {
  return PROVIDER_METADATA[providerId].requiresCredential
}

export function buildProviderGatewayConfig(gatewayRoot: string): {
  provider: Record<string, ProviderRuntimeConfig>
} {
  const normalizedGatewayRoot = gatewayRoot.replace(/\/$/, '')
  const provider: Record<string, ProviderRuntimeConfig> = {}

  for (const providerId of PROVIDERS) {
    const baseURL = `${normalizedGatewayRoot}/${getProviderGatewayPath(providerId)}`
    const metadata = PROVIDER_METADATA[providerId]
    for (const runtimeProviderId of getRuntimeConfigProviderIds(providerId)) {
      provider[runtimeProviderId] = {
        ...metadata.runtimeConfig,
        options: { baseURL },
      }
    }
  }

  return { provider }
}

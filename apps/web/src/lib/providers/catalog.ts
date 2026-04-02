import { PROVIDERS, type ProviderId } from '@/lib/providers/types'

type ProviderMetadata = {
  label: string
  runtimeId: string
  gatewayPath: ProviderId
}

type ProviderRuntimeConfig = {
  options: {
    baseURL: string
  }
}

const PROVIDER_METADATA: Record<ProviderId, ProviderMetadata> = {
  openai: {
    label: 'OpenAI',
    runtimeId: 'openai',
    gatewayPath: 'openai',
  },
  anthropic: {
    label: 'Anthropic',
    runtimeId: 'anthropic',
    gatewayPath: 'anthropic',
  },
  fireworks: {
    label: 'Fireworks AI',
    runtimeId: 'fireworks-ai',
    gatewayPath: 'fireworks',
  },
  openrouter: {
    label: 'OpenRouter',
    runtimeId: 'openrouter',
    gatewayPath: 'openrouter',
  },
  opencode: {
    label: 'OpenCode Zen',
    runtimeId: 'opencode',
    gatewayPath: 'opencode',
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

export function buildProviderGatewayConfig(gatewayRoot: string): {
  provider: Record<string, ProviderRuntimeConfig>
} {
  const normalizedGatewayRoot = gatewayRoot.replace(/\/$/, '')
  const provider: Record<string, ProviderRuntimeConfig> = {}

  for (const providerId of PROVIDERS) {
    const baseURL = `${normalizedGatewayRoot}/${getProviderGatewayPath(providerId)}`
    for (const runtimeProviderId of getRuntimeConfigProviderIds(providerId)) {
      provider[runtimeProviderId] = {
        options: { baseURL },
      }
    }
  }

  return { provider }
}

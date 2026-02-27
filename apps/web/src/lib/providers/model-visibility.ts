import type { AvailableModel } from '@/lib/opencode/types'
import { CREDENTIAL_REQUIRED_PROVIDER_IDS, PROVIDERS, type ProviderId } from '@/lib/providers/types'

const credentialRequiredProviderIds = new Set<ProviderId>(CREDENTIAL_REQUIRED_PROVIDER_IDS)

function toProviderId(value: string): ProviderId | null {
  return PROVIDERS.find((providerId) => providerId === value) ?? null
}

export function filterModelsByEnabledProviders(
  models: AvailableModel[],
  enabledProviderIds: Set<ProviderId>,
): AvailableModel[] {
  return models.filter((model) => {
    const providerId = toProviderId(model.providerId)
    if (!providerId) {
      return true
    }

    if (!credentialRequiredProviderIds.has(providerId)) {
      return true
    }

    return enabledProviderIds.has(providerId)
  })
}

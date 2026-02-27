import type { AvailableModel } from '@/lib/opencode/types'
import { CREDENTIAL_REQUIRED_PROVIDER_IDS, type ProviderId } from '@/lib/providers/types'

const credentialRequiredProviderIds = new Set<ProviderId>(CREDENTIAL_REQUIRED_PROVIDER_IDS)

export function filterModelsByEnabledProviders(
  models: AvailableModel[],
  enabledProviderIds: Set<ProviderId>,
): AvailableModel[] {
  return models.filter((model) => {
    const providerId = model.providerId as ProviderId
    if (!credentialRequiredProviderIds.has(providerId)) {
      return true
    }

    return enabledProviderIds.has(providerId)
  })
}

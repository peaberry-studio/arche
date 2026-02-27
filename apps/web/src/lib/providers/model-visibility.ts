import type { AvailableModel } from '@/lib/opencode/types'
import { CREDENTIAL_REQUIRED_PROVIDER_IDS, isProviderId } from '@/lib/providers/types'
import type { ProviderId } from '@/lib/providers/types'

export function filterModelsByEnabledProviders(
  models: AvailableModel[],
  enabledProviderIds: Set<ProviderId>,
): AvailableModel[] {
  return models.filter((model) => {
    if (!isProviderId(model.providerId)) {
      return true
    }

    if (!CREDENTIAL_REQUIRED_PROVIDER_IDS.includes(model.providerId)) {
      return true
    }

    return enabledProviderIds.has(model.providerId)
  })
}

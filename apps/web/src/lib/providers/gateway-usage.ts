import { providerService, providerUsageService } from '@/lib/services'

import type { ProviderCredentialSource } from './credentials'
import type { ProviderId } from './types'

export function recordProviderGatewayRequestBestEffort(input: {
  credentialSource: ProviderCredentialSource
  isError: boolean
  modelId: string | null
  providerId: ProviderId
  userId: string
}): void {
  void providerUsageService.recordProviderGatewayRequest({
    credentialSource: input.credentialSource,
    isError: input.isError,
    modelId: input.modelId,
    providerId: input.providerId,
    userId: input.userId,
  }).catch((error) => {
    console.warn('[providers/gateway] Failed to record usage', error)
  })
}

export function markCredentialLastUsedBestEffort(input: {
  credentialId: string
  source: ProviderCredentialSource
}): void {
  void providerService.markCredentialLastUsed(input).catch((error) => {
    console.warn('[providers/gateway] Failed to mark credential last used', error)
  })
}

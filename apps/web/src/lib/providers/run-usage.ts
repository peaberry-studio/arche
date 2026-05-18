import { providerUsageService } from '@/lib/services'
import type { ProviderUsageCredentialSource } from '@/lib/services/provider-usage'

import { getEffectiveCredentialForUser } from './store'
import type { ProviderId } from './types'

export type ProviderRunUsageInput = {
  costUsd: number
  inputTokens: number
  messageRunId: string
  modelId: string | null
  outputTokens: number
  providerId: ProviderId
  source: string
  userId: string
}

export function recordProviderRunUsageBestEffort(input: ProviderRunUsageInput, logPrefix: string): void {
  void getEffectiveCredentialForUser({ userId: input.userId, providerId: input.providerId })
    .then((effectiveCredential) => {
      const credentialSource: ProviderUsageCredentialSource | null =
        effectiveCredential?.source ?? (input.providerId === 'opencode' ? 'default' : null)
      if (!credentialSource) return null

      return providerUsageService.recordProviderRunUsage({
        costUsd: input.costUsd,
        credentialSource,
        inputTokens: input.inputTokens,
        messageRunId: input.messageRunId,
        modelId: input.modelId,
        outputTokens: input.outputTokens,
        providerId: input.providerId,
        source: input.source,
        userId: input.userId,
      })
    })
    .catch((error) => {
      console.warn(`${logPrefix} Failed to record provider run usage`, error)
    })
}

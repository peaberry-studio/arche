import { providerUsageService } from '@/lib/services'

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
      if (!effectiveCredential) return null
      return providerUsageService.recordProviderRunUsage({
        costUsd: input.costUsd,
        credentialSource: effectiveCredential.source,
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

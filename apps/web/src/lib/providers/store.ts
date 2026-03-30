import { providerService } from '@/lib/services'
import { encryptProviderSecret } from './crypto'
import type { ProviderId } from './types'

export type ProviderCredentialRecord = {
  id: string
  type: string
  secret: string
  version: number
}

export type ReplaceApiCredentialInput = {
  userId: string
  providerId: ProviderId
  apiKey: string
}

export async function replaceApiCredential(input: ReplaceApiCredentialInput): Promise<ProviderCredentialRecord> {
  const secret = encryptProviderSecret({ apiKey: input.apiKey })
  return providerService.replaceCredential({
    userId: input.userId,
    providerId: input.providerId,
    type: 'api',
    secret,
  })
}

export type ActiveCredentialInput = {
  userId: string
  providerId: ProviderId
}

export async function getActiveCredentialForUser(
  input: ActiveCredentialInput,
): Promise<ProviderCredentialRecord | null> {
  return providerService.findActiveCredential(input.userId, input.providerId)
}

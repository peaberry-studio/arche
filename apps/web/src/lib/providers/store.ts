import { providerService } from '@/lib/services'
import { encryptProviderSecret } from './crypto'
import type { ProviderId } from './types'

export type ProviderCredentialRecord = {
  id: string
  type: string
  secret: string
  version: number
}

export type CreateApiCredentialInput = {
  userId: string
  providerId: ProviderId
  apiKey: string
  version: number
}

export async function createApiCredential(input: CreateApiCredentialInput): Promise<ProviderCredentialRecord> {
  const secret = encryptProviderSecret({ apiKey: input.apiKey })
  return providerService.createCredential({
    userId: input.userId,
    providerId: input.providerId,
    type: 'api',
    status: 'enabled',
    version: input.version,
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

import { providerService } from '@/lib/services'

import { encryptProviderSecret } from './crypto'
import type {
  EffectiveProviderCredential,
  ProviderCredentialRecord,
} from './credentials'
import type { ProviderId } from './types'

export type { EffectiveProviderCredential, ProviderCredentialRecord, ProviderCredentialSource } from './credentials'

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

export type ReplaceOrganizationApiCredentialInput = {
  providerId: ProviderId
  apiKey: string
}

export async function replaceOrganizationApiCredential(
  input: ReplaceOrganizationApiCredentialInput,
): Promise<ProviderCredentialRecord> {
  const secret = encryptProviderSecret({ apiKey: input.apiKey })
  return providerService.replaceOrganizationCredential({
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

export async function getEffectiveCredentialForUser(
  input: ActiveCredentialInput,
): Promise<EffectiveProviderCredential> {
  return providerService.getEffectiveCredentialForUser(input)
}

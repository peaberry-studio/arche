import { providerService } from '@/lib/services'

import { encryptProviderSecret } from './crypto'
import type {
  EffectiveProviderCredential,
  ProviderCredentialRecord,
  ProviderCredentialSource,
} from './credentials'
import { PROVIDERS, type ProviderId } from './types'
import type { ProviderSecret } from './types'

export type { EffectiveProviderCredential, ProviderCredentialRecord, ProviderCredentialSource } from './credentials'

export type EnabledProviderCredential = {
  credentialId: string
  source: ProviderCredentialSource
  version: number
}

export type EnabledProviderCredentials = Map<ProviderId, EnabledProviderCredential>

export type ReplaceApiCredentialInput = {
  userId: string
  providerId: ProviderId
  apiKey: string
}

export type ReplaceProviderCredentialInput = {
  userId: string
  providerId: ProviderId
  secret: ProviderSecret
}

export async function replaceProviderCredential(
  input: ReplaceProviderCredentialInput,
): Promise<ProviderCredentialRecord> {
  const secret = encryptProviderSecret(input.secret)
  return providerService.replaceCredential({
    userId: input.userId,
    providerId: input.providerId,
    type: 'api',
    secret,
  })
}

export async function replaceApiCredential(input: ReplaceApiCredentialInput): Promise<ProviderCredentialRecord> {
  return replaceProviderCredential({
    userId: input.userId,
    providerId: input.providerId,
    secret: { apiKey: input.apiKey },
  })
}

export type ReplaceOrganizationApiCredentialInput = {
  providerId: ProviderId
  apiKey: string
}

export type ReplaceOrganizationProviderCredentialInput = {
  providerId: ProviderId
  secret: ProviderSecret
}

export async function replaceOrganizationProviderCredential(
  input: ReplaceOrganizationProviderCredentialInput,
): Promise<ProviderCredentialRecord> {
  const secret = encryptProviderSecret(input.secret)
  return providerService.replaceOrganizationCredential({
    providerId: input.providerId,
    type: 'api',
    secret,
  })
}

export async function replaceOrganizationApiCredential(
  input: ReplaceOrganizationApiCredentialInput,
): Promise<ProviderCredentialRecord> {
  return replaceOrganizationProviderCredential({
    providerId: input.providerId,
    secret: { apiKey: input.apiKey },
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

export async function getActiveOrganizationCredential(
  providerId: ProviderId,
): Promise<ProviderCredentialRecord | null> {
  return providerService.findActiveOrganizationCredential(providerId)
}

export async function getEnabledProviderCredentialsForUser(userId: string): Promise<EnabledProviderCredentials> {
  const enabledByProvider: EnabledProviderCredentials = new Map()

  for (const providerId of PROVIDERS) {
    const effectiveCredential = await getEffectiveCredentialForUser({
      userId,
      providerId,
    })
    if (!effectiveCredential) {
      continue
    }

    enabledByProvider.set(providerId, {
      credentialId: effectiveCredential.credential.id,
      source: effectiveCredential.source,
      version: Number(effectiveCredential.credential.version),
    })
  }

  return enabledByProvider
}

export async function getEnabledProviderIdsForUser(userId: string): Promise<Set<ProviderId>> {
  return new Set((await getEnabledProviderCredentialsForUser(userId)).keys())
}

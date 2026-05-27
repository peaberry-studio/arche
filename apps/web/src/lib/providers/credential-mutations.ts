import { auditEvent } from '@/lib/auth'
import { getInstanceUrl } from '@/lib/opencode/client'
import { syncProviderAccessForInstance } from '@/lib/opencode/providers'
import { instanceService, providerService } from '@/lib/services'
import { decryptPassword } from '@/lib/spawner/crypto'

import type { ProviderCredentialRecord } from './credentials'
import {
  replaceApiCredential,
  replaceOrganizationApiCredential,
  replaceOrganizationProviderCredential,
  replaceProviderCredential,
} from './store'
import { isPlainApiSecret, type ProviderId, type ProviderSecret } from './types'

export type UserProviderCredentialMutationResult = {
  credential: ProviderCredentialRecord
  restartRequired: boolean
}

export type DisableProviderCredentialResult = {
  disabledCount: number
  restartRequired: boolean
}

export type OrganizationProviderCredentialMutationResult = {
  credential: ProviderCredentialRecord
  invalidatedInstanceCount: number
}

export type DisableOrganizationProviderCredentialResult = {
  disabledCount: number
  invalidatedInstanceCount: number
}

async function syncUserWorkspaceProviderAccessBestEffort(slug: string, userId: string): Promise<boolean> {
  try {
    const instance = await instanceService.findCredentialsBySlug(slug)

    if (!instance || instance.status !== 'running') {
      await providerService.clearWorkspaceRestartRequired(userId)
      return false
    }

    const password = decryptPassword(instance.serverPassword)

    const result = await syncProviderAccessForInstance({
      instance: {
        baseUrl: getInstanceUrl(slug),
        authHeader: `Basic ${Buffer.from(`opencode:${password}`).toString('base64')}`,
      },
      slug,
      userId,
    })
    if (!result.ok && result.error !== 'instance_unavailable') {
      console.error('[providers] Failed to sync provider access', result.error)
      await providerService.markWorkspaceRestartRequired(userId)
      return true
    }

    await providerService.clearWorkspaceRestartRequired(userId)
  } catch (error) {
    console.error('[providers] Failed to sync provider access', error)
    await providerService.markWorkspaceRestartRequired(userId)
    return true
  }

  return false
}

async function invalidateOrganizationProviderSyncState(): Promise<number> {
  const result = await instanceService.invalidateProviderSyncStateForAllInstances()
  return result.count
}

export async function replaceUserProviderApiCredential(input: {
  actorUserId: string
  apiKey: string
  providerId: ProviderId
  targetSlug: string
  targetUserId: string
}): Promise<UserProviderCredentialMutationResult> {
  return replaceUserProviderCredential({
    actorUserId: input.actorUserId,
    providerId: input.providerId,
    secret: { apiKey: input.apiKey },
    targetSlug: input.targetSlug,
    targetUserId: input.targetUserId,
  })
}

export async function replaceUserProviderCredential(input: {
  actorUserId: string
  providerId: ProviderId
  secret: ProviderSecret
  targetSlug: string
  targetUserId: string
}): Promise<UserProviderCredentialMutationResult> {
  const credential = isPlainApiSecret(input.secret)
    ? await replaceApiCredential({
      apiKey: input.secret.apiKey,
      providerId: input.providerId,
      userId: input.targetUserId,
    })
    : await replaceProviderCredential({
      providerId: input.providerId,
      secret: input.secret,
      userId: input.targetUserId,
    })

  const restartRequired = await syncUserWorkspaceProviderAccessBestEffort(input.targetSlug, input.targetUserId)

  await auditEvent({
    actorUserId: input.actorUserId,
    action: 'provider_credential.created',
    metadata: { providerId: input.providerId, credentialId: credential.id },
  })

  return { credential, restartRequired }
}

export async function disableUserProviderApiCredential(input: {
  actorUserId: string
  providerId: ProviderId
  targetSlug: string
  targetUserId: string
}): Promise<DisableProviderCredentialResult> {
  const result = await providerService.disableEnabledForProvider(input.targetUserId, input.providerId)
  const restartRequired = await syncUserWorkspaceProviderAccessBestEffort(input.targetSlug, input.targetUserId)

  await auditEvent({
    actorUserId: input.actorUserId,
    action: 'provider_credential.disabled',
    metadata: {
      providerId: input.providerId,
      disabledCount: result.count,
      targetSlug: input.targetSlug,
    },
  })

  return { disabledCount: result.count, restartRequired }
}

export async function replaceOrganizationProviderApiCredential(input: {
  actorUserId: string
  apiKey: string
  providerId: ProviderId
}): Promise<OrganizationProviderCredentialMutationResult> {
  return replaceOrganizationProviderCredentialValue({
    actorUserId: input.actorUserId,
    providerId: input.providerId,
    secret: { apiKey: input.apiKey },
  })
}

export async function replaceOrganizationProviderCredentialValue(input: {
  actorUserId: string
  providerId: ProviderId
  secret: ProviderSecret
}): Promise<OrganizationProviderCredentialMutationResult> {
  const credential = isPlainApiSecret(input.secret)
    ? await replaceOrganizationApiCredential({
      apiKey: input.secret.apiKey,
      providerId: input.providerId,
    })
    : await replaceOrganizationProviderCredential({
      providerId: input.providerId,
      secret: input.secret,
    })
  const invalidatedInstanceCount = await invalidateOrganizationProviderSyncState()

  await auditEvent({
    actorUserId: input.actorUserId,
    action: 'organization_provider_credential.created',
    metadata: {
      providerId: input.providerId,
      credentialId: credential.id,
      invalidatedInstanceCount,
    },
  })

  return { credential, invalidatedInstanceCount }
}

export async function disableOrganizationProviderApiCredential(input: {
  actorUserId: string
  providerId: ProviderId
}): Promise<DisableOrganizationProviderCredentialResult> {
  const result = await providerService.disableEnabledOrganizationProvider(input.providerId)
  const invalidatedInstanceCount = await invalidateOrganizationProviderSyncState()

  await auditEvent({
    actorUserId: input.actorUserId,
    action: 'organization_provider_credential.disabled',
    metadata: {
      providerId: input.providerId,
      disabledCount: result.count,
      invalidatedInstanceCount,
    },
  })

  return { disabledCount: result.count, invalidatedInstanceCount }
}

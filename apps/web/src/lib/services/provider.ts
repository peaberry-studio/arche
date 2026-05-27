import type { Prisma } from '@prisma/client'

import { prisma } from '@/lib/prisma'
import type {
  EffectiveProviderCredential,
  OrganizationProviderCredentialSummary,
  ProviderCredentialRecord,
  ProviderCredentialSource,
  ProviderCredentialSummary,
} from '@/lib/providers/credentials'
import { PROVIDER_SYNC_RESTART_REQUIRED } from '@/lib/providers/sync-status'

const MAX_PROVIDER_CREDENTIAL_RETRIES = 3
const SERIALIZABLE_ISOLATION_LEVEL = 'Serializable' as Prisma.TransactionIsolationLevel

// ---------------------------------------------------------------------------
// Query return shapes
// ---------------------------------------------------------------------------

export type {
  EffectiveProviderCredential,
  OrganizationProviderCredentialSummary,
  ProviderCredentialRecord,
  ProviderCredentialSource,
  ProviderCredentialSummary,
}

// ---------------------------------------------------------------------------
// Queries
// ---------------------------------------------------------------------------

export function findActiveCredential(
  userId: string,
  providerId: string,
): Promise<ProviderCredentialRecord | null> {
  return prisma.providerCredential.findFirst({
    where: { userId, providerId, status: 'enabled' },
    orderBy: { version: 'desc' },
    select: { id: true, type: true, secret: true, version: true },
  })
}

export function findActiveOrganizationCredential(
  providerId: string,
): Promise<ProviderCredentialRecord | null> {
  return prisma.organizationProviderCredential.findFirst({
    where: { providerId, status: 'enabled' },
    orderBy: { version: 'desc' },
    select: { id: true, type: true, secret: true, version: true },
  })
}

export async function getEffectiveCredentialForUser(input: {
  userId: string
  providerId: string
}): Promise<EffectiveProviderCredential> {
  const userCredential = await findActiveCredential(input.userId, input.providerId)
  if (userCredential) {
    return { source: 'user', credential: userCredential }
  }

  const organizationCredential = await findActiveOrganizationCredential(input.providerId)
  if (organizationCredential) {
    return { source: 'organization', credential: organizationCredential }
  }

  return null
}

export function findCredentialsByUserAndProviders(
  userId: string,
  providerIds: string[],
): Promise<ProviderCredentialSummary[]> {
  return prisma.providerCredential.findMany({
    where: { userId, providerId: { in: providerIds } },
    select: { id: true, providerId: true, secret: true, status: true, type: true, version: true },
    orderBy: { version: 'desc' },
  })
}

export function findOrganizationCredentialsByProviders(
  providerIds: string[],
): Promise<OrganizationProviderCredentialSummary[]> {
  return prisma.organizationProviderCredential.findMany({
    where: { providerId: { in: providerIds } },
    select: { id: true, providerId: true, secret: true, status: true, type: true, version: true, lastUsedAt: true },
    orderBy: { version: 'desc' },
  })
}

export async function hasPendingRestartByUserId(userId: string): Promise<boolean> {
  const marker = await prisma.providerCredential.findFirst({
    where: { userId, lastError: PROVIDER_SYNC_RESTART_REQUIRED },
    select: { id: true },
  })

  return Boolean(marker)
}

// ---------------------------------------------------------------------------
// Mutations
// ---------------------------------------------------------------------------

export function replaceCredential(data: {
  userId: string
  providerId: string
  type: string
  secret: string
}): Promise<ProviderCredentialRecord> {
  return replaceCredentialWithRetry(data)
}

export function replaceOrganizationCredential(data: {
  providerId: string
  type: string
  secret: string
}): Promise<ProviderCredentialRecord> {
  return replaceOrganizationCredentialWithRetry(data)
}

async function replaceCredentialWithRetry(data: {
  userId: string
  providerId: string
  type: string
  secret: string
}): Promise<ProviderCredentialRecord> {
  for (let attempt = 0; attempt < MAX_PROVIDER_CREDENTIAL_RETRIES; attempt += 1) {
    try {
      return await prisma.$transaction(async (tx) => {
        const latest = await tx.providerCredential.findFirst({
          where: { userId: data.userId, providerId: data.providerId },
          orderBy: { version: 'desc' },
          select: { version: true },
        })
        const nextVersion = (latest?.version ?? 0) + 1

        await tx.providerCredential.updateMany({
          where: { userId: data.userId, providerId: data.providerId },
          data: { status: 'disabled' },
        })

        return tx.providerCredential.create({
          data: {
            userId: data.userId,
            providerId: data.providerId,
            type: data.type,
            status: 'enabled',
            version: nextVersion,
            secret: data.secret,
          },
          select: { id: true, type: true, secret: true, version: true },
        })
      }, {
        isolationLevel: SERIALIZABLE_ISOLATION_LEVEL,
      })
    } catch (error) {
      if (isTransactionConflict(error) && attempt < MAX_PROVIDER_CREDENTIAL_RETRIES - 1) {
        continue
      }

      throw error
    }
  }

  throw new Error('unreachable')
}

async function replaceOrganizationCredentialWithRetry(data: {
  providerId: string
  type: string
  secret: string
}): Promise<ProviderCredentialRecord> {
  for (let attempt = 0; attempt < MAX_PROVIDER_CREDENTIAL_RETRIES; attempt += 1) {
    try {
      return await prisma.$transaction(async (tx) => {
        const latest = await tx.organizationProviderCredential.findFirst({
          where: { providerId: data.providerId },
          orderBy: { version: 'desc' },
          select: { version: true },
        })
        const nextVersion = (latest?.version ?? 0) + 1

        await tx.organizationProviderCredential.updateMany({
          where: { providerId: data.providerId },
          data: { status: 'disabled' },
        })

        return tx.organizationProviderCredential.create({
          data: {
            providerId: data.providerId,
            type: data.type,
            status: 'enabled',
            version: nextVersion,
            secret: data.secret,
          },
          select: { id: true, type: true, secret: true, version: true },
        })
      }, {
        isolationLevel: SERIALIZABLE_ISOLATION_LEVEL,
      })
    } catch (error) {
      if (isTransactionConflict(error) && attempt < MAX_PROVIDER_CREDENTIAL_RETRIES - 1) {
        continue
      }

      throw error
    }
  }

  throw new Error('unreachable')
}

function isTransactionConflict(error: unknown): error is { code: string } {
  return (
    typeof error === 'object' &&
    error !== null &&
    'code' in error &&
    (error as { code?: unknown }).code === 'P2034'
  )
}

export function disableEnabledForProvider(userId: string, providerId: string) {
  return prisma.providerCredential.updateMany({
    where: { userId, providerId, status: 'enabled' },
    data: { status: 'disabled' },
  })
}

export function disableEnabledOrganizationProvider(providerId: string) {
  return prisma.organizationProviderCredential.updateMany({
    where: { providerId, status: 'enabled' },
    data: { status: 'disabled' },
  })
}

export function markCredentialLastUsed(input: {
  source: ProviderCredentialSource
  credentialId: string
  lastUsedAt?: Date
}) {
  const lastUsedAt = input.lastUsedAt ?? new Date()

  if (input.source === 'organization') {
    return prisma.organizationProviderCredential.updateMany({
      where: { id: input.credentialId },
      data: { lastUsedAt },
    })
  }

  return prisma.providerCredential.updateMany({
    where: { id: input.credentialId },
    data: { lastUsedAt },
  })
}

export function markWorkspaceRestartRequired(userId: string) {
  return prisma.providerCredential.updateMany({
    where: { userId },
    data: { lastError: PROVIDER_SYNC_RESTART_REQUIRED },
  })
}

export function clearWorkspaceRestartRequired(userId: string) {
  return prisma.providerCredential.updateMany({
    where: { userId, lastError: PROVIDER_SYNC_RESTART_REQUIRED },
    data: { lastError: null },
  })
}

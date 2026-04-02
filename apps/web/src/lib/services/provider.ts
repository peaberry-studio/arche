import type { Prisma } from '@prisma/client'

import { PROVIDER_SYNC_RESTART_REQUIRED } from '@/lib/providers/sync-status'
import { prisma } from '@/lib/prisma'

const MAX_PROVIDER_CREDENTIAL_RETRIES = 3
const SERIALIZABLE_ISOLATION_LEVEL = 'Serializable' as Prisma.TransactionIsolationLevel

// ---------------------------------------------------------------------------
// Query return shapes
// ---------------------------------------------------------------------------

export type ProviderCredentialRecord = {
  id: string
  type: string
  secret: string
  version: number
}

export type ProviderCredentialSummary = {
  providerId: string
  status: string
  type: string
  version: number
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

export function findCredentialsByUserAndProviders(
  userId: string,
  providerIds: string[],
): Promise<ProviderCredentialSummary[]> {
  return prisma.providerCredential.findMany({
    where: { userId, providerId: { in: providerIds } },
    select: { providerId: true, status: true, type: true, version: true },
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

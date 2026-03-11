import { prisma } from '@/lib/prisma'

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

export function findLatestVersion(
  userId: string,
  providerId: string,
): Promise<Array<{ version: number }>> {
  return prisma.providerCredential.findMany({
    where: { userId, providerId },
    select: { version: true },
    orderBy: { version: 'desc' },
    take: 1,
  })
}

// ---------------------------------------------------------------------------
// Mutations
// ---------------------------------------------------------------------------

export function createCredential(data: {
  userId: string
  providerId: string
  type: string
  status: 'enabled' | 'disabled'
  version: number
  secret: string
}): Promise<ProviderCredentialRecord> {
  return prisma.providerCredential.create({
    data,
    select: { id: true, type: true, secret: true, version: true },
  })
}

export function disableAllForProvider(userId: string, providerId: string) {
  return prisma.providerCredential.updateMany({
    where: { userId, providerId },
    data: { status: 'disabled' },
  })
}

export function disableEnabledForProvider(userId: string, providerId: string) {
  return prisma.providerCredential.updateMany({
    where: { userId, providerId, status: 'enabled' },
    data: { status: 'disabled' },
  })
}

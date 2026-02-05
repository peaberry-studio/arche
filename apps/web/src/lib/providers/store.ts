import { prisma } from '@/lib/prisma'
import { encryptProviderSecret } from './crypto'
import type { ProviderCredentialType, ProviderId } from './types'

export type ProviderCredentialRecord = {
  id: string
  type: ProviderCredentialType
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
  return prisma.providerCredential.create({
    data: {
      userId: input.userId,
      providerId: input.providerId,
      type: 'api',
      status: 'enabled',
      version: input.version,
      secret,
    },
    select: {
      id: true,
      type: true,
      secret: true,
      version: true,
    },
  })
}

export type ActiveCredentialInput = {
  userId: string
  providerId: ProviderId
}

export async function getActiveCredentialForUser(
  input: ActiveCredentialInput,
): Promise<ProviderCredentialRecord | null> {
  return prisma.providerCredential.findFirst({
    where: {
      userId: input.userId,
      providerId: input.providerId,
      status: 'enabled',
    },
    orderBy: {
      version: 'desc',
    },
    select: {
      id: true,
      type: true,
      secret: true,
      version: true,
    },
  })
}

import { prisma } from '@/lib/prisma'

export type ExternalIntegrationRecord = {
  key: string
  config: string
  state: unknown
  version: number
  createdAt: Date
  updatedAt: Date
}

export async function findByKey(key: string): Promise<ExternalIntegrationRecord | null> {
  const row = await prisma.externalIntegration.findUnique({ where: { key } })
  if (!row) return null
  return row as ExternalIntegrationRecord
}

export async function upsertByKey(
  key: string,
  config: string,
  state?: unknown,
): Promise<ExternalIntegrationRecord> {
  const result = await prisma.externalIntegration.upsert({
    where: { key },
    create: { key, config, state: state ?? {} },
    update: { config, state: state ?? {}, version: { increment: 1 } },
  })
  return result as ExternalIntegrationRecord
}

export async function updateStateByKey(key: string, state: unknown): Promise<void> {
  await prisma.externalIntegration.updateMany({
    where: { key },
    data: { state: state ?? {} },
  })
}

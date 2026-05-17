import { Prisma } from '@prisma/client'

import { prisma } from '@/lib/prisma'

export type ProviderUsageCredentialSource = 'user' | 'organization'

export type RecordProviderRunUsageResult =
  | { ok: true; recorded: true }
  | { ok: true; recorded: false }

export type ProviderUsageFilters = {
  from?: Date
  to?: Date
  userId?: string
  providerId?: string
  modelId?: string
}

export type ProviderUsageTotals = {
  requestCount: number
  errorCount: number
  runCount: number
  inputTokens: number
  outputTokens: number
  costUsd: number
}

type UsageDimensionInput = {
  credentialSource: ProviderUsageCredentialSource
  modelId?: string | null
  providerId: string
  source?: string
  userId: string
}

type ProviderUsageDailyKey = {
  bucketDate: Date
  credentialSource: ProviderUsageCredentialSource
  modelId: string
  providerId: string
  source: string
  userId: string
}

function getBucketDate(date: Date): Date {
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()))
}

function normalizeModelId(modelId: string | null | undefined): string {
  return modelId?.trim() ?? ''
}

function normalizeSource(source: string | null | undefined): string {
  return source?.trim() || 'unknown'
}

function buildDailyKey(input: UsageDimensionInput & { at: Date }): ProviderUsageDailyKey {
  return {
    bucketDate: getBucketDate(input.at),
    credentialSource: input.credentialSource,
    modelId: normalizeModelId(input.modelId),
    providerId: input.providerId,
    source: normalizeSource(input.source),
    userId: input.userId,
  }
}

function isUniqueConstraintError(error: unknown): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    'code' in error &&
    error.code === 'P2002'
  )
}

function emptyTotals(): ProviderUsageTotals {
  return {
    costUsd: 0,
    errorCount: 0,
    inputTokens: 0,
    outputTokens: 0,
    requestCount: 0,
    runCount: 0,
  }
}

function addTotals(total: ProviderUsageTotals, row: {
  costUsd: Prisma.Decimal
  errorCount: number
  inputTokens: number
  outputTokens: number
  requestCount: number
  runCount: number
}): void {
  total.costUsd += row.costUsd.toNumber()
  total.errorCount += row.errorCount
  total.inputTokens += row.inputTokens
  total.outputTokens += row.outputTokens
  total.requestCount += row.requestCount
  total.runCount += row.runCount
}

function buildDailyWhere(filters: ProviderUsageFilters): Prisma.ProviderUsageDailyWhereInput {
  return {
    ...(filters.from || filters.to
      ? {
          bucketDate: {
            ...(filters.from ? { gte: getBucketDate(filters.from) } : {}),
            ...(filters.to ? { lte: getBucketDate(filters.to) } : {}),
          },
        }
      : {}),
    ...(filters.userId ? { userId: filters.userId } : {}),
    ...(filters.providerId ? { providerId: filters.providerId } : {}),
    ...(filters.modelId ? { modelId: normalizeModelId(filters.modelId) } : {}),
  }
}

export async function recordProviderGatewayRequest(input: UsageDimensionInput & {
  isError: boolean
  requestedAt?: Date
}): Promise<void> {
  const key = buildDailyKey({
    ...input,
    at: input.requestedAt ?? new Date(),
    source: input.source ?? 'gateway',
  })
  const errorIncrement = input.isError ? 1 : 0

  await prisma.providerUsageDaily.upsert({
    where: {
      bucketDate_userId_providerId_modelId_source_credentialSource: key,
    },
    create: {
      ...key,
      errorCount: errorIncrement,
      requestCount: 1,
    },
    update: {
      errorCount: { increment: errorIncrement },
      requestCount: { increment: 1 },
    },
  })
}

export async function recordProviderRunUsage(input: UsageDimensionInput & {
  costUsd: number
  inputTokens: number
  messageRunId: string
  outputTokens: number
  recordedAt?: Date
}): Promise<RecordProviderRunUsageResult> {
  const recordedAt = input.recordedAt ?? new Date()
  const key = buildDailyKey({ ...input, at: recordedAt })
  const costUsd = new Prisma.Decimal(input.costUsd)

  try {
    await prisma.$transaction([
      prisma.providerUsageRun.create({
        data: {
          credentialSource: key.credentialSource,
          costUsd,
          inputTokens: input.inputTokens,
          messageRunId: input.messageRunId,
          modelId: key.modelId,
          outputTokens: input.outputTokens,
          providerId: key.providerId,
          source: key.source,
          userId: key.userId,
        },
      }),
      prisma.providerUsageDaily.upsert({
        where: {
          bucketDate_userId_providerId_modelId_source_credentialSource: key,
        },
        create: {
          ...key,
          costUsd,
          inputTokens: input.inputTokens,
          outputTokens: input.outputTokens,
          runCount: 1,
        },
        update: {
          costUsd: { increment: costUsd },
          inputTokens: { increment: input.inputTokens },
          outputTokens: { increment: input.outputTokens },
          runCount: { increment: 1 },
        },
      }),
    ])
  } catch (error) {
    if (isUniqueConstraintError(error)) {
      return { ok: true, recorded: false }
    }

    throw error
  }

  return { ok: true, recorded: true }
}

export async function getProviderUsageSummary(filters: ProviderUsageFilters): Promise<ProviderUsageTotals> {
  const rows = await prisma.providerUsageDaily.findMany({
    where: buildDailyWhere(filters),
    select: {
      costUsd: true,
      errorCount: true,
      inputTokens: true,
      outputTokens: true,
      requestCount: true,
      runCount: true,
    },
  })

  const total = emptyTotals()
  for (const row of rows) {
    addTotals(total, row)
  }
  return total
}

export async function listProviderUsageUsers(filters: ProviderUsageFilters): Promise<Array<ProviderUsageTotals & {
  user: { id: string; email: string; slug: string } | null
  userId: string
}>> {
  const rows = await prisma.providerUsageDaily.findMany({
    where: buildDailyWhere(filters),
    include: {
      user: { select: { id: true, email: true, slug: true } },
    },
  })

  const byUser = new Map<string, ProviderUsageTotals & {
    user: { id: string; email: string; slug: string } | null
    userId: string
  }>()

  for (const row of rows) {
    const current = byUser.get(row.userId) ?? { ...emptyTotals(), user: row.user, userId: row.userId }
    addTotals(current, row)
    byUser.set(row.userId, current)
  }

  return Array.from(byUser.values()).sort((left, right) => right.requestCount - left.requestCount)
}

export async function listProviderUsageProviders(filters: ProviderUsageFilters): Promise<Array<ProviderUsageTotals & {
  credentialSource: string
  modelId: string
  providerId: string
  source: string
}>> {
  const rows = await prisma.providerUsageDaily.findMany({
    where: buildDailyWhere(filters),
  })

  const byProvider = new Map<string, ProviderUsageTotals & {
    credentialSource: string
    modelId: string
    providerId: string
    source: string
  }>()

  for (const row of rows) {
    const key = [row.providerId, row.modelId, row.source, row.credentialSource].join('\0')
    const current = byProvider.get(key) ?? {
      ...emptyTotals(),
      credentialSource: row.credentialSource,
      modelId: row.modelId,
      providerId: row.providerId,
      source: row.source,
    }
    addTotals(current, row)
    byProvider.set(key, current)
  }

  return Array.from(byProvider.values()).sort((left, right) => right.requestCount - left.requestCount)
}

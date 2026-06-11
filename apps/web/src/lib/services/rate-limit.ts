import { prisma } from '@/lib/prisma'
import { isDesktop } from '@/lib/runtime/mode'

type RateLimitBucketRow = {
  count: number
  resetAt?: Date | string | number
  reset_at?: Date | string | number
}

export async function checkDbRateLimit(
  key: string,
  maxAttempts: number,
  windowMs: number
): Promise<{ allowed: boolean; remaining: number; resetAt: number }> {
  if (isDesktop()) {
    return { allowed: true, remaining: maxAttempts, resetAt: Date.now() + windowMs }
  }

  const now = new Date()
  const resetAt = new Date(now.getTime() + windowMs)

  const rows = await prisma.$queryRaw<RateLimitBucketRow[]>`
    INSERT INTO "rate_limit_buckets" ("key", "count", "reset_at", "updated_at")
    VALUES (${key}, 1, ${resetAt}, ${now})
    ON CONFLICT ("key") DO UPDATE SET
      "count" = CASE
        WHEN "rate_limit_buckets"."reset_at" <= ${now} THEN 1
        WHEN "rate_limit_buckets"."count" < ${maxAttempts} THEN "rate_limit_buckets"."count" + 1
        ELSE ${maxAttempts + 1}
      END,
      "reset_at" = CASE
        WHEN "rate_limit_buckets"."reset_at" <= ${now} THEN ${resetAt}
        ELSE "rate_limit_buckets"."reset_at"
      END,
      "updated_at" = ${now}
    RETURNING "count", "reset_at" AS "resetAt"
  `

  const bucket = rows[0]
  if (!bucket) {
    throw new Error('rate_limit_transition_failed')
  }

  return {
    allowed: bucket.count <= maxAttempts,
    remaining: Math.max(0, maxAttempts - bucket.count),
    resetAt: parseResetAt(bucket),
  }
}

export function deleteExpiredRateLimitBuckets(now = new Date()) {
  return prisma.rateLimitBucket.deleteMany({ where: { resetAt: { lte: now } } })
}

function parseResetAt(bucket: RateLimitBucketRow): number {
  const value = bucket.resetAt ?? bucket.reset_at
  if (value instanceof Date) return value.getTime()
  if (typeof value === 'string' || typeof value === 'number') {
    const timestamp = new Date(value).getTime()
    if (Number.isFinite(timestamp)) return timestamp
  }

  throw new Error('rate_limit_transition_invalid_reset')
}

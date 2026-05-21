import { prisma } from '@/lib/prisma'

type McpRateLimitRow = {
  count: bigint | number
  resetAt: Date
}

export async function checkMcpRateLimit(
  key: string,
  maxAttempts: number,
  windowMs: number,
): Promise<{ allowed: boolean; remaining: number; resetAt: number }> {
  const resetAt = new Date(Date.now() + windowMs)
  const rows = await prisma.$queryRaw<McpRateLimitRow[]>`
    INSERT INTO "mcp_rate_limit_buckets" ("key", "count", "reset_at", "created_at", "updated_at")
    VALUES (${key}, 1, ${resetAt}, NOW(), NOW())
    ON CONFLICT ("key") DO UPDATE
    SET
      "count" = CASE
        WHEN "mcp_rate_limit_buckets"."reset_at" <= NOW() THEN 1
        ELSE "mcp_rate_limit_buckets"."count" + 1
      END,
      "reset_at" = CASE
        WHEN "mcp_rate_limit_buckets"."reset_at" <= NOW() THEN ${resetAt}
        ELSE "mcp_rate_limit_buckets"."reset_at"
      END,
      "updated_at" = NOW()
    RETURNING "count", "reset_at" AS "resetAt"
  `

  const row = rows[0]
  if (!row) {
    throw new Error('mcp_rate_limit_failed')
  }

  const count = typeof row.count === 'bigint' ? Number(row.count) : row.count
  return {
    allowed: count <= maxAttempts,
    remaining: Math.max(0, maxAttempts - count),
    resetAt: row.resetAt.getTime(),
  }
}

import { prisma } from '@/lib/prisma'

export async function checkDbRateLimit(
  key: string,
  maxAttempts: number,
  windowMs: number
): Promise<{ allowed: boolean; remaining: number; resetAt: number }> {
  const now = new Date()
  const resetAt = new Date(now.getTime() + windowMs)

  const incremented = await prisma.rateLimitBucket.updateMany({
    where: {
      key,
      resetAt: { gt: now },
      count: { lt: maxAttempts },
    },
    data: {
      count: { increment: 1 },
    },
  })

  if (incremented.count > 0) {
    const bucket = await prisma.rateLimitBucket.findUnique({ where: { key } })
    const count = bucket?.count ?? maxAttempts
    const resetTime = bucket?.resetAt.getTime() ?? resetAt.getTime()
    return { allowed: true, remaining: Math.max(0, maxAttempts - count), resetAt: resetTime }
  }

  const active = await prisma.rateLimitBucket.findFirst({
    where: { key, resetAt: { gt: now } },
  })

  if (active && active.count >= maxAttempts) {
    return { allowed: false, remaining: 0, resetAt: active.resetAt.getTime() }
  }

  const created = await prisma.rateLimitBucket.upsert({
    where: { key },
    update: { count: 1, resetAt },
    create: { key, count: 1, resetAt },
  })

  return { allowed: true, remaining: maxAttempts - 1, resetAt: created.resetAt.getTime() }
}

export function deleteExpiredRateLimitBuckets(now = new Date()) {
  return prisma.rateLimitBucket.deleteMany({ where: { resetAt: { lte: now } } })
}

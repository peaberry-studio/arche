import { prisma } from '@/lib/prisma'
import { isUniqueConstraintError } from '@/lib/services/slack/errors'

export async function hasEventReceipt(eventId: string): Promise<boolean> {
  const receipt = await prisma.slackEventReceipt.findUnique({
    where: { eventId },
    select: { id: true },
  })

  return Boolean(receipt)
}

export async function recordEventReceipt(args: {
  eventId: string
  type: string
  receivedAt: Date
}): Promise<boolean> {
  try {
    await prisma.slackEventReceipt.create({
      data: {
        eventId: args.eventId,
        type: args.type,
        receivedAt: args.receivedAt,
      },
    })
    return true
  } catch (error) {
    if (isUniqueConstraintError(error)) {
      return false
    }

    throw error
  }
}

export function pruneEventReceipts(olderThan: Date) {
  return prisma.slackEventReceipt.deleteMany({
    where: {
      receivedAt: {
        lt: olderThan,
      },
    },
  })
}

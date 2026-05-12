import { prisma } from '@/lib/prisma'
import type { SlackThreadBindingRecord } from '@/lib/services/slack/records'

export function findThreadBinding(channelId: string, threadTs: string): Promise<SlackThreadBindingRecord | null> {
  return prisma.slackThreadBinding.findUnique({
    where: {
      channelId_threadTs: {
        channelId,
        threadTs,
      },
    },
  })
}

export function upsertThreadBinding(args: {
  channelId: string
  threadTs: string
  openCodeSessionId: string
  executionUserId: string
}): Promise<SlackThreadBindingRecord> {
  return prisma.slackThreadBinding.upsert({
    where: {
      channelId_threadTs: {
        channelId: args.channelId,
        threadTs: args.threadTs,
      },
    },
    create: args,
    update: {
      openCodeSessionId: args.openCodeSessionId,
      executionUserId: args.executionUserId,
    },
  })
}

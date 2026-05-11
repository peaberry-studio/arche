import { prisma } from '@/lib/prisma'
import type { SlackNotificationChannelRecord } from '@/lib/services/slack/records'

export async function upsertNotificationChannelsFromSlack(
  slackTeamId: string,
  channels: Array<{ channelId: string; name: string; isPrivate: boolean }>,
): Promise<void> {
  if (channels.length === 0) {
    return
  }

  await prisma.$transaction(channels.map((channel) => (
    prisma.slackNotificationChannel.upsert({
      where: {
        slackTeamId_channelId: {
          channelId: channel.channelId,
          slackTeamId,
        },
      },
      create: {
        channelId: channel.channelId,
        enabled: true,
        isPrivate: channel.isPrivate,
        name: channel.name,
        slackTeamId,
      },
      update: {
        isPrivate: channel.isPrivate,
          name: channel.name,
      },
    })
  )))
}

export function listNotificationChannels(
  slackTeamId: string,
): Promise<SlackNotificationChannelRecord[]> {
  return prisma.slackNotificationChannel.findMany({
    where: { slackTeamId },
    orderBy: [
      { isPrivate: 'asc' },
      { name: 'asc' },
    ],
  })
}

export function listEnabledNotificationChannels(
  slackTeamId: string,
): Promise<SlackNotificationChannelRecord[]> {
  return prisma.slackNotificationChannel.findMany({
    where: {
      enabled: true,
      slackTeamId,
    },
    orderBy: [
      { isPrivate: 'asc' },
      { name: 'asc' },
    ],
  })
}

export async function setNotificationChannelEnabledById(
  id: string,
  enabled: boolean,
): Promise<void> {
  await prisma.slackNotificationChannel.updateMany({
    where: { id },
    data: { enabled },
  })
}

export async function isNotificationChannelAllowed(
  slackTeamId: string,
  channelId: string,
): Promise<boolean> {
  const channel = await prisma.slackNotificationChannel.findFirst({
    where: {
      channelId,
      enabled: true,
      slackTeamId,
    },
    select: { id: true },
  })

  return Boolean(channel)
}

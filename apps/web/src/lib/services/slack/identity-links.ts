import { prisma } from '@/lib/prisma'
import { createSlackAuditEvent } from '@/lib/services/slack/audit'
import { isUniqueConstraintError } from '@/lib/services/slack/errors'
import type { SlackUserLinkRecord } from '@/lib/services/slack/records'
import { normalizeOptionalSlackText } from '@/lib/services/slack/text'

export function findUserLinkBySlackUser(
  slackTeamId: string,
  slackUserId: string,
): Promise<SlackUserLinkRecord | null> {
  return prisma.slackUserLink.findUnique({
    where: {
      slackTeamId_slackUserId: {
        slackTeamId,
        slackUserId,
      },
    },
  })
}

export async function upsertUserLink(data: {
  userId: string
  slackTeamId: string
  slackUserId: string
  slackEmail: string | null
  displayName: string | null
}): Promise<SlackUserLinkRecord> {
  const slackEmail = normalizeOptionalSlackText(data.slackEmail)
  const displayName = normalizeOptionalSlackText(data.displayName)
  const existing = await findUserLinkBySlackUser(data.slackTeamId, data.slackUserId)
  const lastSeenAt = new Date()

  if (existing) {
    if (existing.userId !== data.userId) {
      await createSlackAuditEvent({
        actorUserId: data.userId,
        action: 'slack.user_link_conflict',
        metadata: {
          existingUserId: existing.userId,
          slackEmail,
          slackTeamId: data.slackTeamId,
          slackUserId: data.slackUserId,
        },
      })
      throw new Error('slack_user_link_conflict')
    }

    return prisma.slackUserLink.update({
      where: { id: existing.id },
      data: {
        displayName,
        lastSeenAt,
        slackEmail,
      },
    })
  }

  try {
    const link = await prisma.slackUserLink.create({
      data: {
        displayName,
        lastSeenAt,
        slackEmail,
        slackTeamId: data.slackTeamId,
        slackUserId: data.slackUserId,
        userId: data.userId,
      },
    })

    await createSlackAuditEvent({
      actorUserId: data.userId,
      action: 'slack.user_linked',
      metadata: {
        slackEmail,
        slackTeamId: data.slackTeamId,
        slackUserId: data.slackUserId,
      },
    })

    return link
  } catch (error) {
    if (!isUniqueConstraintError(error)) {
      throw error
    }

    const conflict = await findUserLinkBySlackUser(data.slackTeamId, data.slackUserId)
    if (!conflict) {
      throw error
    }

    if (conflict.userId === data.userId) {
      return prisma.slackUserLink.update({
        where: { id: conflict.id },
        data: {
          displayName,
          lastSeenAt,
          slackEmail,
        },
      })
    }

    await createSlackAuditEvent({
      actorUserId: data.userId,
      action: 'slack.user_link_conflict',
      metadata: {
        existingUserId: conflict.userId,
        slackEmail,
        slackTeamId: data.slackTeamId,
        slackUserId: data.slackUserId,
      },
    })
    throw new Error('slack_user_link_conflict')
  }
}

export async function resolveArcheUserFromSlackUser(
  slackTeamId: string,
  slackUserId: string,
  slackEmail: string | null,
  displayName: string | null,
): Promise<{ ok: true; user: { id: string; slug: string } } | { ok: false; error: string }> {
  const existing = await prisma.slackUserLink.findUnique({
    where: {
      slackTeamId_slackUserId: {
        slackTeamId,
        slackUserId,
      },
    },
    include: {
      user: {
        select: {
          id: true,
          kind: true,
          slug: true,
        },
      },
    },
  })

  if (existing) {
    if (existing.user.kind !== 'HUMAN') {
      return { ok: false, error: 'slack_user_not_linked_to_human' }
    }

    await prisma.slackUserLink.update({
      where: { id: existing.id },
      data: {
        displayName: normalizeOptionalSlackText(displayName),
        lastSeenAt: new Date(),
        slackEmail: normalizeOptionalSlackText(slackEmail),
      },
    })

    return {
      ok: true,
      user: {
        id: existing.user.id,
        slug: existing.user.slug,
      },
    }
  }

  const email = normalizeOptionalSlackText(slackEmail)
  if (!email) {
    return { ok: false, error: 'slack_email_missing' }
  }

  const user = await prisma.user.findFirst({
    where: {
      kind: 'HUMAN',
      email: {
        equals: email,
        mode: 'insensitive',
      },
    },
    select: {
      id: true,
      slug: true,
    },
  })

  if (!user) {
    return { ok: false, error: 'slack_email_not_found' }
  }

  await upsertUserLink({
    displayName,
    slackEmail: email,
    slackTeamId,
    slackUserId,
    userId: user.id,
  })

  return { ok: true, user }
}

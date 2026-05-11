import { prisma } from '@/lib/prisma'
import { createSlackAuditEvent } from '@/lib/services/slack/audit'
import { normalizeOptionalSlackText } from '@/lib/services/slack/text'
import type { SlackUserLinkRecord } from '@/lib/services/slack/records'

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

  const link = await prisma.slackUserLink.upsert({
    where: {
      slackTeamId_slackUserId: {
        slackTeamId: data.slackTeamId,
        slackUserId: data.slackUserId,
      },
    },
    create: {
      displayName,
      lastSeenAt,
      slackEmail,
      slackTeamId: data.slackTeamId,
      slackUserId: data.slackUserId,
      userId: data.userId,
    },
    update: {
      displayName,
      lastSeenAt,
      slackEmail,
      userId: data.userId,
    },
  })

  if (!existing || existing.userId !== data.userId) {
    await createSlackAuditEvent({
      actorUserId: data.userId,
      action: 'slack.user_linked',
      metadata: {
        slackEmail,
        slackTeamId: data.slackTeamId,
        slackUserId: data.slackUserId,
      },
    })
  }

  return link
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

  const emailCandidates = Array.from(new Set([email, email.toLowerCase()]))
  const user = await prisma.user.findFirst({
    where: {
      kind: 'HUMAN',
      OR: emailCandidates.map((candidate) => ({ email: candidate })),
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

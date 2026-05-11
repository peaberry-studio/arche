import { NextResponse } from 'next/server'

import { prisma } from '@/lib/prisma'
import { requireCapability } from '@/lib/runtime/require-capability'
import { withAuth } from '@/lib/runtime/with-auth'
import { slackService, userService } from '@/lib/services'

export const GET = withAuth(
  { csrf: false },
  async (_request, { slug, user }) => {
    const denied = requireCapability('autopilot')
    if (denied) return denied

    const workspaceUser = await userService.findIdentityBySlug(slug)
    if (!workspaceUser) {
      return NextResponse.json({ error: 'not_found' }, { status: 404 })
    }

    if (workspaceUser.id !== user.id && user.role !== 'ADMIN') {
      return NextResponse.json({ error: 'forbidden' }, { status: 403 })
    }

    try {
      const teamMembers = await userService.findTeamMembers()
      const slackLinks = await prisma.slackUserLink.findMany({
        where: {
          userId: {
            in: teamMembers.map((member) => member.id),
          },
        },
        select: {
          userId: true,
        },
      })
      const linkedUserIds = new Set(slackLinks.map((link) => link.userId))
      const integration = await slackService.findIntegration()
      const integrationEnabled = Boolean(integration?.enabled && integration.slackTeamId)
      const channels = integrationEnabled && integration?.slackTeamId
        ? await slackService.listEnabledNotificationChannels(integration.slackTeamId)
        : []

      return NextResponse.json({
        channels: channels.map((channel) => ({
          channelId: channel.channelId,
          isPrivate: channel.isPrivate,
          name: channel.name,
        })),
        integrationEnabled,
        users: teamMembers.map((member) => ({
          email: member.email,
          id: member.id,
          slackLinked: linkedUserIds.has(member.id),
        })),
      })
    } catch (error) {
      console.error('[slack-targets] Failed to load targets', error)
      return NextResponse.json({ error: 'internal_error' }, { status: 500 })
    }
  },
)

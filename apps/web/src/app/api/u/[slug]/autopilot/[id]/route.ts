import { Prisma } from '@prisma/client'
import { NextResponse } from 'next/server'

import { auditEvent } from '@/lib/auth'
import { getNextAutopilotRunAt, validateAutopilotCronExpression } from '@/lib/autopilot/cron'
import { validateAutopilotTaskPayload } from '@/lib/autopilot/payload'
import { serializeAutopilotTaskDetail } from '@/lib/autopilot/serializers'
import type { AutopilotTaskDetail } from '@/lib/autopilot/types'
import { requireCapability } from '@/lib/runtime/require-capability'
import { withAuth } from '@/lib/runtime/with-auth'
import { autopilotService, userService } from '@/lib/services'

type AutopilotTaskRouteParams = {
  id: string
  slug: string
}

async function resolveUserIdForSlug(slug: string, contextUser: { id: string; slug: string }) {
  if (contextUser.slug === slug) {
    return contextUser.id
  }

  const owner = await userService.findIdBySlug(slug)
  return owner?.id ?? null
}

export const GET = withAuth<{ task: AutopilotTaskDetail } | { error: string }, AutopilotTaskRouteParams>(
  { csrf: false },
  async (_request, { params: { id }, slug, user }) => {
    const denied = requireCapability('autopilot')
    if (denied) return denied

    const userId = await resolveUserIdForSlug(slug, user)
    if (!userId) {
      return NextResponse.json({ error: 'not_found' }, { status: 404 })
    }

    const task = await autopilotService.findTaskByIdAndUserId(id, userId)
    if (!task) {
      return NextResponse.json({ error: 'not_found' }, { status: 404 })
    }

    return NextResponse.json({ task: serializeAutopilotTaskDetail(task) })
  },
)

export const PATCH = withAuth<{ task: AutopilotTaskDetail } | { error: string }, AutopilotTaskRouteParams>(
  { csrf: true },
  async (request, { params: { id }, slug, user }) => {
    const denied = requireCapability('autopilot')
    if (denied) return denied

    const userId = await resolveUserIdForSlug(slug, user)
    if (!userId) {
      return NextResponse.json({ error: 'not_found' }, { status: 404 })
    }

    const existing = await autopilotService.findTaskByIdAndUserId(id, userId)
    if (!existing) {
      return NextResponse.json({ error: 'not_found' }, { status: 404 })
    }

    let body: unknown
    try {
      body = await request.json()
    } catch (error) {
      if (error instanceof SyntaxError) {
        return NextResponse.json({ error: 'invalid_json' }, { status: 400 })
      }

      throw error
    }

    const payload = await validateAutopilotTaskPayload(body, 'update', {
      fallbackTimezone: existing.timezone,
    })
    if (!payload.ok) {
      return NextResponse.json({ error: payload.error }, { status: payload.status })
    }

    const nextTimezone = payload.value.timezone ?? existing.timezone
    const nextCronExpression = payload.value.cronExpression ?? existing.cronExpression

    try {
      validateAutopilotCronExpression(nextCronExpression, nextTimezone)
    } catch {
      return NextResponse.json({ error: 'invalid_cron_expression' }, { status: 400 })
    }

    const enabledChanged = typeof payload.value.enabled === 'boolean' && payload.value.enabled !== existing.enabled
    const scheduleChanged =
      nextTimezone !== existing.timezone ||
      nextCronExpression !== existing.cronExpression

    const nextEnabled = payload.value.enabled ?? existing.enabled
    const nextRunAt = nextEnabled && (enabledChanged || scheduleChanged)
      ? getNextAutopilotRunAt(nextCronExpression, nextTimezone, new Date())
      : undefined

    try {
      const updated = await autopilotService.updateTaskByIdAndUserId(id, userId, {
        name: payload.value.name,
        prompt: payload.value.prompt,
        targetAgentId: payload.value.targetAgentId,
        cronExpression: payload.value.cronExpression,
        timezone: payload.value.timezone,
        enabled: payload.value.enabled,
        nextRunAt,
      })

      if (!updated) {
        return NextResponse.json({ error: 'not_found' }, { status: 404 })
      }

      await auditEvent({
        actorUserId: user.id,
        action: 'autopilot.task_updated',
        metadata: {
          slug,
          taskId: id,
        },
      })

      const detail = await autopilotService.findTaskByIdAndUserId(id, userId)
      if (!detail) {
        return NextResponse.json({ error: 'not_found' }, { status: 404 })
      }

      return NextResponse.json({ task: serializeAutopilotTaskDetail(detail) })
    } catch (error) {
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === 'P2002'
      ) {
        return NextResponse.json({ error: 'task_name_exists' }, { status: 409 })
      }

      throw error
    }
  },
)

export const DELETE = withAuth<{ ok: true } | { error: string }, AutopilotTaskRouteParams>(
  { csrf: true },
  async (_request, { params: { id }, slug, user }) => {
    const denied = requireCapability('autopilot')
    if (denied) return denied

    const userId = await resolveUserIdForSlug(slug, user)
    if (!userId) {
      return NextResponse.json({ error: 'not_found' }, { status: 404 })
    }

    const deleted = await autopilotService.deleteTaskByIdAndUserId(id, userId)
    if (deleted.count === 0) {
      return NextResponse.json({ error: 'not_found' }, { status: 404 })
    }

    await auditEvent({
      actorUserId: user.id,
      action: 'autopilot.task_deleted',
      metadata: {
        slug,
        taskId: id,
      },
    })

    return NextResponse.json({ ok: true })
  },
)

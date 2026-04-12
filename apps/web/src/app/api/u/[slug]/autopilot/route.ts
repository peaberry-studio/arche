import { Prisma } from '@prisma/client'
import { NextResponse } from 'next/server'

import { auditEvent } from '@/lib/auth'
import { getNextAutopilotRunAt } from '@/lib/autopilot/cron'
import { validateAutopilotTaskPayload } from '@/lib/autopilot/payload'
import { triggerAutopilotTaskNow } from '@/lib/autopilot/runner'
import { serializeAutopilotTaskDetail, serializeAutopilotTaskListItem } from '@/lib/autopilot/serializers'
import type { AutopilotTaskDetail, AutopilotTaskListItem } from '@/lib/autopilot/types'
import { requireCapability } from '@/lib/runtime/require-capability'
import { withAuth } from '@/lib/runtime/with-auth'
import { autopilotService, userService } from '@/lib/services'

type AutopilotListResponse = {
  tasks: AutopilotTaskListItem[]
}

async function resolveUserIdForSlug(slug: string, contextUser: { id: string; slug: string }) {
  if (contextUser.slug === slug) {
    return contextUser.id
  }

  const owner = await userService.findIdBySlug(slug)
  return owner?.id ?? null
}

export const GET = withAuth<AutopilotListResponse | { error: string }>(
  { csrf: false },
  async (_request, { slug, user }) => {
    const denied = requireCapability('autopilot')
    if (denied) return denied

    const userId = await resolveUserIdForSlug(slug, user)
    if (!userId) {
      return NextResponse.json({ error: 'not_found' }, { status: 404 })
    }

    const tasks = await autopilotService.listTasksByUserId(userId)
    return NextResponse.json({ tasks: tasks.map(serializeAutopilotTaskListItem) })
  },
)

export const POST = withAuth<{ task: AutopilotTaskDetail } | { error: string }>(
  { csrf: true },
  async (request, { slug, user }) => {
    const denied = requireCapability('autopilot')
    if (denied) return denied

    let body: unknown
    try {
      body = await request.json()
    } catch (error) {
      if (error instanceof SyntaxError) {
        return NextResponse.json({ error: 'invalid_json' }, { status: 400 })
      }

      throw error
    }

    const payload = await validateAutopilotTaskPayload(body, 'create')
    if (!payload.ok) {
      return NextResponse.json({ error: payload.error }, { status: payload.status })
    }

    const userId = await resolveUserIdForSlug(slug, user)
    if (!userId) {
      return NextResponse.json({ error: 'not_found' }, { status: 404 })
    }

    try {
      const now = new Date()
      const task = await autopilotService.createTask({
        userId,
        name: payload.value.name ?? '',
        prompt: payload.value.prompt ?? '',
        targetAgentId: payload.value.targetAgentId ?? null,
        cronExpression: payload.value.cronExpression ?? '',
        timezone: payload.value.timezone ?? 'UTC',
        enabled: payload.value.enabled ?? true,
        nextRunAt: getNextAutopilotRunAt(
          payload.value.cronExpression ?? '',
          payload.value.timezone ?? 'UTC',
          now,
        ),
      })

      await auditEvent({
        actorUserId: user.id,
        action: 'autopilot.task_created',
        metadata: {
          slug,
          taskId: task.id,
        },
      })

      if (task.enabled) {
        try {
          const triggerResult = await triggerAutopilotTaskNow({
            taskId: task.id,
            trigger: 'on_create',
            userId,
          })

          if (!triggerResult.ok) {
            console.error('[autopilot] Failed to trigger initial task run', {
              reason: triggerResult.error,
              slug,
              taskId: task.id,
              userId,
            })
          }
        } catch (error) {
          console.error('[autopilot] Unexpected error triggering initial task run', {
            error,
            slug,
            taskId: task.id,
            userId,
          })
        }
      }

      const detail = await autopilotService.findTaskByIdAndUserId(task.id, userId)
      if (!detail) {
        return NextResponse.json({ error: 'not_found' }, { status: 404 })
      }

      return NextResponse.json(
        { task: serializeAutopilotTaskDetail(detail) },
        { status: 201 },
      )
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

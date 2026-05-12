import { Prisma } from '@prisma/client'
import { NextResponse } from 'next/server'

import { auditEvent } from '@/lib/auth'
import { resolveFlowOwnerUserId } from '@/lib/flows/api'
import { getNextFlowRunAt, validateFlowCronExpression } from '@/lib/flows/cron'
import { validateFlowPayload } from '@/lib/flows/payload'
import { validateFlowSlackNotificationAccess } from '@/lib/flows/route-auth'
import { serializeFlowDetail, toPrismaJson } from '@/lib/flows/serializers'
import type { FlowDetail, FlowSlackNotificationConfig } from '@/lib/flows/types'
import { requireCapability } from '@/lib/runtime/require-capability'
import { withAuth } from '@/lib/runtime/with-auth'
import { flowService } from '@/lib/services'

type FlowRouteParams = {
  id: string
  slug: string
}

export const GET = withAuth<{ flow: FlowDetail } | { error: string }, FlowRouteParams>(
  { csrf: false },
  async (_request, { params: { id }, slug, user }) => {
    const denied = requireCapability('flows')
    if (denied) return denied

    const userId = await resolveFlowOwnerUserId(slug, user)
    if (!userId) return NextResponse.json({ error: 'not_found' }, { status: 404 })

    const flow = await flowService.findFlowByIdAndUserId(id, userId)
    if (!flow) return NextResponse.json({ error: 'not_found' }, { status: 404 })

    return NextResponse.json({ flow: serializeFlowDetail(flow) })
  },
)

export const PATCH = withAuth<{ flow: FlowDetail } | { error: string }, FlowRouteParams>(
  { csrf: true },
  async (request, { params: { id }, slug, user }) => {
    const denied = requireCapability('flows')
    if (denied) return denied

    const userId = await resolveFlowOwnerUserId(slug, user)
    if (!userId) return NextResponse.json({ error: 'not_found' }, { status: 404 })

    const existing = await flowService.findFlowByIdAndUserId(id, userId)
    if (!existing) return NextResponse.json({ error: 'not_found' }, { status: 404 })

    let body: unknown
    try {
      body = await request.json()
    } catch (error) {
      if (error instanceof SyntaxError) {
        return NextResponse.json({ error: 'invalid_json' }, { status: 400 })
      }
      throw error
    }

    const payload = await validateFlowPayload(body, 'update', { fallbackTimezone: existing.timezone })
    if (!payload.ok) {
      return NextResponse.json({ error: payload.error }, { status: payload.status })
    }

    const nextTimezone = payload.value.timezone ?? existing.timezone
    const nextCronExpression = payload.value.cronExpression === undefined
      ? existing.cronExpression
      : payload.value.cronExpression
    const nextEnabled = payload.value.enabled ?? existing.enabled

    if (nextEnabled && !nextCronExpression) {
      return NextResponse.json({ error: 'schedule_required' }, { status: 400 })
    }

    if (nextCronExpression) {
      try {
        validateFlowCronExpression(nextCronExpression, nextTimezone)
      } catch {
        return NextResponse.json({ error: 'invalid_cron_expression' }, { status: 400 })
      }
    }

    const scheduleChanged = nextCronExpression !== existing.cronExpression || nextTimezone !== existing.timezone
    const enabledChanged = typeof payload.value.enabled === 'boolean' && payload.value.enabled !== existing.enabled
    const nextRunAt = nextEnabled && nextCronExpression && (scheduleChanged || enabledChanged)
      ? getNextFlowRunAt(nextCronExpression, nextTimezone, new Date())
      : !nextEnabled || !nextCronExpression
        ? null
        : undefined

    const updateData: {
      cronExpression?: string | null
      definition?: ReturnType<typeof toPrismaJson>
      description?: string | null
      enabled?: boolean
      name?: string
      nextRunAt?: Date | null
      slackNotificationConfig?: FlowSlackNotificationConfig | null
      timezone?: string
    } = {
      cronExpression: payload.value.cronExpression,
      definition: payload.value.definition ? toPrismaJson(payload.value.definition) : undefined,
      description: payload.value.description,
      enabled: payload.value.enabled,
      name: payload.value.name,
      nextRunAt,
      timezone: payload.value.timezone,
    }
    if ('slackNotificationConfig' in payload.value) {
      updateData.slackNotificationConfig = payload.value.slackNotificationConfig ?? null
    }

    const slackNotificationAccess = await validateFlowSlackNotificationAccess(
      payload.value.slackNotificationConfig,
      user,
      userId,
    )
    if (!slackNotificationAccess.ok) {
      return NextResponse.json(
        { error: slackNotificationAccess.error },
        { status: slackNotificationAccess.status },
      )
    }

    try {
      const updated = await flowService.updateFlowByIdAndUserId(id, userId, updateData)

      if (!updated) return NextResponse.json({ error: 'not_found' }, { status: 404 })

      await auditEvent({
        action: 'flows.flow_updated',
        actorUserId: user.id,
        metadata: { flowId: id, slug },
      })

      const detail = await flowService.findFlowByIdAndUserId(id, userId)
      if (!detail) return NextResponse.json({ error: 'not_found' }, { status: 404 })

      return NextResponse.json({ flow: serializeFlowDetail(detail) })
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
        return NextResponse.json({ error: 'flow_name_exists' }, { status: 409 })
      }

      throw error
    }
  },
)

export const DELETE = withAuth<{ ok: true } | { error: string }, FlowRouteParams>(
  { csrf: true },
  async (_request, { params: { id }, slug, user }) => {
    const denied = requireCapability('flows')
    if (denied) return denied

    const userId = await resolveFlowOwnerUserId(slug, user)
    if (!userId) return NextResponse.json({ error: 'not_found' }, { status: 404 })

    const deleted = await flowService.deleteFlowByIdAndUserId(id, userId)
    if (deleted.count === 0) return NextResponse.json({ error: 'not_found' }, { status: 404 })

    await auditEvent({
      action: 'flows.flow_deleted',
      actorUserId: user.id,
      metadata: { flowId: id, slug },
    })

    return NextResponse.json({ ok: true })
  },
)

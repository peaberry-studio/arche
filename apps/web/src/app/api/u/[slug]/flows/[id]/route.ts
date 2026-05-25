import { Prisma } from '@prisma/client'
import { NextResponse } from 'next/server'

import { auditEvent } from '@/lib/auth'
import { resolveFlowRouteContext } from '@/lib/flows/api'
import { createFlowActorScope } from '@/lib/flows/authorization'
import {
  checkMissingConnectorRequirements,
  getFlowConnectorRequirements,
} from '@/lib/flows/connector-requirements'
import { getNextFlowRunAt, validateFlowCronExpression } from '@/lib/flows/cron'
import { validateFlowPayload } from '@/lib/flows/payload'
import { canEditFlow, canManageFlow, canViewFlow } from '@/lib/flows/permissions'
import { validateFlowSlackNodeAccess } from '@/lib/flows/route-auth'
import { serializeFlowDetail, toPrismaJson } from '@/lib/flows/serializers'
import type { FlowDetail } from '@/lib/flows/types'
import { validateFlowDefinition } from '@/lib/flows/validation'
import { requireCapability } from '@/lib/runtime/require-capability'
import { withAuth } from '@/lib/runtime/with-auth'
import { flowService } from '@/lib/services'

type FlowRouteParams = {
  id: string
  slug: string
}

async function serializeFlowDetailForUser(
  flow: Awaited<ReturnType<typeof flowService.findFlowByIdForScope>> & {},
  user: { id: string; role: string },
): Promise<FlowDetail> {
  const detail = serializeFlowDetail(flow, user)
  if (!detail.permissions.canRun) return detail

  const requirements = await getFlowConnectorRequirements(detail.definition)
  if (!requirements.ok) return detail

  detail.connectorRequirements = requirements.requirements
  detail.missingConnectorRequirements = await checkMissingConnectorRequirements(requirements.requirements, user.id)
  return detail
}

export const GET = withAuth<{ flow: FlowDetail } | { error: string }, FlowRouteParams>(
  { csrf: false },
  async (_request, { params: { id }, slug, user }) => {
    const denied = requireCapability('flows')
    if (denied) return denied

    const routeContext = await resolveFlowRouteContext(slug, user)
    if (!routeContext) return NextResponse.json({ error: 'not_found' }, { status: 404 })
    const scope = createFlowActorScope(user, routeContext.workspaceUserId)

    const flow = await flowService.findFlowByIdForScope(id, scope)
    if (!flow) return NextResponse.json({ error: 'not_found' }, { status: 404 })
    if (!canViewFlow(user, flow)) return NextResponse.json({ error: 'not_found' }, { status: 404 })

    return NextResponse.json({ flow: await serializeFlowDetailForUser(flow, user) })
  },
)

export const PATCH = withAuth<{ flow: FlowDetail } | { error: string }, FlowRouteParams>(
  { csrf: true },
  async (request, { params: { id }, slug, user }) => {
    const denied = requireCapability('flows')
    if (denied) return denied

    const routeContext = await resolveFlowRouteContext(slug, user)
    if (!routeContext) return NextResponse.json({ error: 'not_found' }, { status: 404 })
    const scope = createFlowActorScope(user, routeContext.workspaceUserId)

    const existing = await flowService.findFlowByIdForScope(id, scope)
    if (!existing) return NextResponse.json({ error: 'not_found' }, { status: 404 })
    if (!canEditFlow(user, existing)) return NextResponse.json({ error: 'forbidden' }, { status: 403 })

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
    const nextVisibility = payload.value.visibility ?? existing.visibility
    const nextOrganizationCanRun = nextVisibility === 'team'
      ? payload.value.organizationCanRun ?? existing.organizationCanRun
      : false

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
      organizationCanRun?: boolean
      timezone?: string
      visibility?: 'private' | 'team'
    } = {
      cronExpression: payload.value.cronExpression,
      definition: payload.value.definition ? toPrismaJson(payload.value.definition) : undefined,
      description: payload.value.description,
      enabled: payload.value.enabled,
      name: payload.value.name,
      nextRunAt,
      organizationCanRun: payload.value.organizationCanRun !== undefined || payload.value.visibility !== undefined
        ? nextOrganizationCanRun
        : undefined,
      timezone: payload.value.timezone,
      visibility: payload.value.visibility,
    }
    const existingDefinition = validateFlowDefinition(existing.definition)
    if (!payload.value.definition && !existingDefinition.ok) {
      return NextResponse.json({ error: existingDefinition.error }, { status: 400 })
    }

    const slackNodeAccess = await validateFlowSlackNodeAccess(
      payload.value.definition ?? (existingDefinition.ok ? existingDefinition.definition : null),
      user,
      existing.userId,
    )
    if (!slackNodeAccess.ok) {
      return NextResponse.json(
        { error: slackNodeAccess.error },
        { status: slackNodeAccess.status },
      )
    }

    try {
      const updated = await flowService.updateFlowByIdAndOwnerId(id, existing.userId, updateData)

      if (!updated) return NextResponse.json({ error: 'not_found' }, { status: 404 })

      await auditEvent({
        action: 'flows.flow_updated',
        actorUserId: user.id,
        metadata: { flowId: id, slug },
      })

      const detail = await flowService.findFlowByIdForScope(id, createFlowActorScope(user, existing.userId))
      if (!detail) return NextResponse.json({ error: 'not_found' }, { status: 404 })

      return NextResponse.json({ flow: await serializeFlowDetailForUser(detail, user) })
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

    const routeContext = await resolveFlowRouteContext(slug, user)
    if (!routeContext) return NextResponse.json({ error: 'not_found' }, { status: 404 })
    const scope = createFlowActorScope(user, routeContext.workspaceUserId)

    const existing = await flowService.findFlowByIdForScope(id, scope)
    if (!existing) return NextResponse.json({ error: 'not_found' }, { status: 404 })
    if (!canManageFlow(user, existing)) return NextResponse.json({ error: 'forbidden' }, { status: 403 })

    const deleted = await flowService.deleteFlowByIdAndOwnerId(id, existing.userId)
    if (deleted.count === 0) return NextResponse.json({ error: 'not_found' }, { status: 404 })

    await auditEvent({
      action: 'flows.flow_deleted',
      actorUserId: user.id,
      metadata: { flowId: id, slug },
    })

    return NextResponse.json({ ok: true })
  },
)

import { Prisma } from '@prisma/client'
import { NextResponse } from 'next/server'

import { auditEvent } from '@/lib/auth'
import { resolveFlowRouteContext } from '@/lib/flows/api'
import { getNextFlowRunAt } from '@/lib/flows/cron'
import { validateFlowPayload } from '@/lib/flows/payload'
import { validateFlowSlackNodeAccess } from '@/lib/flows/route-auth'
import { triggerFlowNow } from '@/lib/flows/runner'
import { serializeFlowDetail, serializeFlowListItem, toPrismaJson } from '@/lib/flows/serializers'
import type { FlowDetail, FlowListItem } from '@/lib/flows/types'
import { requireCapability } from '@/lib/runtime/require-capability'
import { withAuth } from '@/lib/runtime/with-auth'
import { flowService } from '@/lib/services'

type FlowListResponse = {
  flows: FlowListItem[]
}

export const GET = withAuth<FlowListResponse | { error: string }>(
  { csrf: false },
  async (_request, { slug, user }) => {
    const denied = requireCapability('flows')
    if (denied) return denied

    const routeContext = await resolveFlowRouteContext(slug, user)
    if (!routeContext) return NextResponse.json({ error: 'not_found' }, { status: 404 })

    const flows = await flowService.listFlowsByUserId(routeContext.workspaceUserId)
    return NextResponse.json({ flows: flows.map((flow) => serializeFlowListItem(flow, user)) })
  },
)

export const POST = withAuth<{ flow: FlowDetail } | { error: string }>(
  { csrf: true },
  async (request, { slug, user }) => {
    const denied = requireCapability('flows')
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

    const payload = await validateFlowPayload(body, 'create')
    if (!payload.ok) {
      return NextResponse.json({ error: payload.error }, { status: payload.status })
    }

    const routeContext = await resolveFlowRouteContext(slug, user)
    if (!routeContext) return NextResponse.json({ error: 'not_found' }, { status: 404 })

    const slackNodeAccess = await validateFlowSlackNodeAccess(
      payload.value.definition,
      user,
      routeContext.workspaceUserId,
    )
    if (!slackNodeAccess.ok) {
      return NextResponse.json(
        { error: slackNodeAccess.error },
        { status: slackNodeAccess.status },
      )
    }

    try {
      const cronExpression = payload.value.cronExpression ?? null
      const definition = payload.value.definition
      const enabled = payload.value.enabled ?? false
      const name = payload.value.name
      const organizationCanRun = payload.value.visibility === 'team'
        ? payload.value.organizationCanRun ?? false
        : false
      const timezone = payload.value.timezone ?? 'UTC'
      const visibility = payload.value.visibility ?? 'private'
      if (!definition || !name) {
        return NextResponse.json({ error: 'invalid_body' }, { status: 400 })
      }

      const flow = await flowService.createFlow({
        cronExpression,
        definition: toPrismaJson(definition),
        description: payload.value.description ?? null,
        enabled,
        name,
        nextRunAt: enabled && cronExpression ? getNextFlowRunAt(cronExpression, timezone, new Date()) : null,
        organizationCanRun,
        timezone,
        userId: routeContext.workspaceUserId,
        visibility,
      })

      await auditEvent({
        action: 'flows.flow_created',
        actorUserId: user.id,
        metadata: { flowId: flow.id, slug },
      })

      if (flow.enabled) {
        const triggerResult = await triggerFlowNow({
          flowId: flow.id,
          executionUserId: routeContext.workspaceUserId,
          trigger: 'on_create',
          userId: routeContext.workspaceUserId,
        })
        if (!triggerResult.ok) {
          console.error('[flows] Failed to trigger initial flow run', {
            flowId: flow.id,
            reason: triggerResult.error,
            slug,
            userId: routeContext.workspaceUserId,
          })
        }
      }

      const detail = await flowService.findFlowByIdAndUserId(flow.id, routeContext.workspaceUserId)
      if (!detail) return NextResponse.json({ error: 'not_found' }, { status: 404 })

      return NextResponse.json({ flow: serializeFlowDetail(detail, user) }, { status: 201 })
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
        return NextResponse.json({ error: 'flow_name_exists' }, { status: 409 })
      }

      throw error
    }
  },
)

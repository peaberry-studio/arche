import { Prisma } from '@prisma/client'
import { NextResponse } from 'next/server'

import { auditEvent } from '@/lib/auth'
import { resolveFlowOwnerUserId } from '@/lib/flows/api'
import { getNextFlowRunAt } from '@/lib/flows/cron'
import { validateFlowPayload } from '@/lib/flows/payload'
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

    const userId = await resolveFlowOwnerUserId(slug, user)
    if (!userId) return NextResponse.json({ error: 'not_found' }, { status: 404 })

    const flows = await flowService.listFlowsByUserId(userId)
    return NextResponse.json({ flows: flows.map(serializeFlowListItem) })
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

    const userId = await resolveFlowOwnerUserId(slug, user)
    if (!userId) return NextResponse.json({ error: 'not_found' }, { status: 404 })

    try {
      const cronExpression = payload.value.cronExpression ?? null
      const definition = payload.value.definition
      const enabled = payload.value.enabled ?? false
      const name = payload.value.name
      const timezone = payload.value.timezone ?? 'UTC'
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
        timezone,
        userId,
      })

      await auditEvent({
        action: 'flows.flow_created',
        actorUserId: user.id,
        metadata: { flowId: flow.id, slug },
      })

      if (flow.enabled) {
        const triggerResult = await triggerFlowNow({
          flowId: flow.id,
          trigger: 'on_create',
          userId,
        })
        if (!triggerResult.ok) {
          console.error('[flows] Failed to trigger initial flow run', {
            flowId: flow.id,
            reason: triggerResult.error,
            slug,
            userId,
          })
        }
      }

      const detail = await flowService.findFlowByIdAndUserId(flow.id, userId)
      if (!detail) return NextResponse.json({ error: 'not_found' }, { status: 404 })

      return NextResponse.json({ flow: serializeFlowDetail(detail) }, { status: 201 })
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
        return NextResponse.json({ error: 'flow_name_exists' }, { status: 409 })
      }

      throw error
    }
  },
)

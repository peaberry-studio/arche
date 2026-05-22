import { Prisma } from '@prisma/client'
import { NextResponse } from 'next/server'

import { auditEvent } from '@/lib/auth'
import { resolveFlowOwnerUserId } from '@/lib/flows/api'
import { canCopyFlow } from '@/lib/flows/permissions'
import { serializeFlowDetail, toPrismaJson } from '@/lib/flows/serializers'
import type { FlowDetail } from '@/lib/flows/types'
import { validateFlowDefinition } from '@/lib/flows/validation'
import { requireCapability } from '@/lib/runtime/require-capability'
import { withAuth } from '@/lib/runtime/with-auth'
import { flowService } from '@/lib/services'

type FlowCopyRouteParams = {
  id: string
  slug: string
}

export const POST = withAuth<{ flow: FlowDetail } | { error: string }, FlowCopyRouteParams>(
  { csrf: true },
  async (_request, { params: { id }, slug, user }) => {
    const denied = requireCapability('flows')
    if (denied) return denied

    const userId = await resolveFlowOwnerUserId(slug, user)
    if (!userId) return NextResponse.json({ error: 'not_found' }, { status: 404 })

    const source = await flowService.findFlowByIdAndUserId(id, userId)
    if (!source) return NextResponse.json({ error: 'not_found' }, { status: 404 })
    if (!canCopyFlow(user, source)) return NextResponse.json({ error: 'not_found' }, { status: 404 })

    const definition = validateFlowDefinition(source.definition)
    if (!definition.ok) return NextResponse.json({ error: definition.error }, { status: 400 })

    try {
      const copy = await flowService.createFlow({
        cronExpression: null,
        definition: toPrismaJson(definition.definition),
        description: source.description,
        enabled: false,
        name: `Copy of ${source.name}`,
        nextRunAt: null,
        organizationCanRun: false,
        timezone: source.timezone,
        userId: user.id,
        visibility: 'private',
      })

      await auditEvent({
        action: 'flows.flow_copied',
        actorUserId: user.id,
        metadata: { copiedFlowId: copy.id, sourceFlowId: source.id, slug },
      })

      const detail = await flowService.findFlowByIdAndUserId(copy.id, user.id)
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

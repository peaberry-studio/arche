import { NextResponse } from 'next/server'

import { auditEvent } from '@/lib/auth'
import { resolveFlowRouteContext } from '@/lib/flows/api'
import {
  checkMissingConnectorRequirements,
  getFlowConnectorRequirements,
} from '@/lib/flows/connector-requirements'
import { canRunFlow } from '@/lib/flows/permissions'
import { triggerFlowNow } from '@/lib/flows/runner'
import { validateFlowDefinition } from '@/lib/flows/validation'
import { requireCapability } from '@/lib/runtime/require-capability'
import { withAuth } from '@/lib/runtime/with-auth'
import { flowService } from '@/lib/services'

type FlowRunRouteParams = {
  id: string
  slug: string
}

export const POST = withAuth<{ ok: true } | { error: string }, FlowRunRouteParams>(
  { csrf: true },
  async (_request, { params: { id }, slug, user }) => {
    const denied = requireCapability('flows')
    if (denied) return denied

    const routeContext = await resolveFlowRouteContext(slug, user)
    if (!routeContext) return NextResponse.json({ error: 'not_found' }, { status: 404 })

    const flow = await flowService.findFlowByIdAndUserId(id, routeContext.workspaceUserId)
    if (!flow) return NextResponse.json({ error: 'not_found' }, { status: 404 })
    if (!canRunFlow(user, flow)) return NextResponse.json({ error: 'forbidden' }, { status: 403 })

    const definition = validateFlowDefinition(flow.definition)
    if (!definition.ok) return NextResponse.json({ error: definition.error }, { status: 400 })

    const requirements = await getFlowConnectorRequirements(definition.definition)
    if (!requirements.ok) {
      return NextResponse.json({ error: requirements.error }, { status: requirements.error === 'kb_unavailable' ? 503 : 400 })
    }

    const missingConnectorRequirements = await checkMissingConnectorRequirements(requirements.requirements, user.id)
    if (missingConnectorRequirements.length > 0) {
      return NextResponse.json(
        { error: 'missing_connectors', missingConnectorRequirements },
        { status: 400 },
      )
    }

    const result = await triggerFlowNow({ executionUserId: user.id, flowId: id, trigger: 'manual' })
    if (!result.ok) {
      return NextResponse.json({ error: result.error }, { status: result.error === 'flow_busy' ? 409 : 404 })
    }

    await auditEvent({
      action: 'flows.flow_manual_run_requested',
      actorUserId: user.id,
      metadata: { executionUserId: user.id, flowId: id, ownerUserId: flow.userId, slug },
    })

    return NextResponse.json({ ok: true }, { status: 202 })
  },
)

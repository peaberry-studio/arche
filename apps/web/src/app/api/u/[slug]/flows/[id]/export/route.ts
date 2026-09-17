import { NextResponse } from 'next/server'

import { auditEvent } from '@/lib/auth'
import { contentDispositionHeader } from '@/lib/workspace-attachments'
import { resolveFlowRouteContext } from '@/lib/flows/api'
import { createFlowActorScope } from '@/lib/flows/authorization'
import { createFlowTemplate, type FlowTemplate } from '@/lib/flows/import-export'
import { canViewFlow } from '@/lib/flows/permissions'
import { validateFlowDefinition } from '@/lib/flows/validation'
import { requireCapability } from '@/lib/runtime/require-capability'
import { withAuth } from '@/lib/runtime/with-auth'
import { flowService } from '@/lib/services'

type FlowExportRouteParams = {
  id: string
  slug: string
}

function flowExportFileName(name: string): string {
  const slug = name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
  return `${slug || 'flow'}-template.json`
}

export const GET = withAuth<FlowTemplate | { error: string }, FlowExportRouteParams>(
  { csrf: false },
  async (_request, { params: { id }, slug, user }) => {
    const denied = requireCapability('flows')
    if (denied) return denied

    const routeContext = await resolveFlowRouteContext(slug, user)
    if (!routeContext) return NextResponse.json({ error: 'not_found' }, { status: 404 })

    const flow = await flowService.findFlowByIdForScope(
      id,
      createFlowActorScope(user, routeContext.workspaceUserId),
    )
    if (!flow) return NextResponse.json({ error: 'not_found' }, { status: 404 })
    if (!canViewFlow(user, flow)) return NextResponse.json({ error: 'not_found' }, { status: 404 })

    const definition = validateFlowDefinition(flow.definition)
    if (!definition.ok) return NextResponse.json({ error: definition.error }, { status: 400 })

    await auditEvent({
      action: 'flows.flow_exported',
      actorUserId: user.id,
      metadata: { flowId: id, slug },
    })

    return NextResponse.json(createFlowTemplate({
      cronExpression: flow.cronExpression,
      definition: definition.definition,
      description: flow.description,
      enabled: flow.enabled,
      name: flow.name,
      timezone: flow.timezone,
    }), {
      headers: {
        'Content-Disposition': contentDispositionHeader(flowExportFileName(flow.name)),
      },
    })
  },
)

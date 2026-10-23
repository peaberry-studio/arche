import { auditEvent } from '@/lib/auth'
import { resolveFlowRouteContext } from '@/lib/flows/api'
import { createFlowActorScope } from '@/lib/flows/authorization'
import { serializeFlowDetail, toPrismaJson } from '@/lib/flows/serializers'
import { getFlowDefinitionRevision } from '@/lib/flows/sharing-approval'
import type { FlowDetail } from '@/lib/flows/types'
import { isRecord } from '@/lib/records'
import { requireCapability } from '@/lib/runtime/require-capability'
import { withAuth } from '@/lib/runtime/with-auth'
import { flowService } from '@/lib/services'

export const POST = withAuth<{ flow: FlowDetail } | { error: string }, { slug: string; id: string }>(
  { csrf: true },
  async (request, { params: { id }, slug, user }) => {
    const denied = requireCapability('flows')
    if (denied) return denied
    if (user.role !== 'ADMIN') return Response.json({ error: 'forbidden' }, { status: 403 })
    const context = await resolveFlowRouteContext(slug, user)
    if (!context) return Response.json({ error: 'not_found' }, { status: 404 })
    const scope = createFlowActorScope(user, context.workspaceUserId)
    const flow = await flowService.findFlowByIdForScope(id, scope)
    if (!flow) return Response.json({ error: 'not_found' }, { status: 404 })
    let body: unknown
    try { body = await request.json() } catch {
      return Response.json({ error: 'invalid_json' }, { status: 400 })
    }
    if (!isRecord(body) || typeof body.revision !== 'string' || typeof body.approved !== 'boolean') {
      return Response.json({ error: 'invalid_body' }, { status: 400 })
    }
    const revision = getFlowDefinitionRevision(flow.definition)
    if (body.revision !== revision) return Response.json({ error: 'flow_changed' }, { status: 409 })
    if (flow.visibility !== 'team' || !flow.organizationCanRun) {
      return Response.json({ error: 'flow_sharing_disabled' }, { status: 409 })
    }
    if (!await flowService.setFlowSharingApproval(id, flow.updatedAt, toPrismaJson(flow.definition), body.approved ? revision : null)) {
      return Response.json({ error: 'flow_changed' }, { status: 409 })
    }
    await auditEvent({ actorUserId: user.id, action: 'flows.sharing_approval_updated', metadata: { flowId: id, revision, approved: body.approved } })
    const updated = await flowService.findFlowByIdForScope(id, scope)
    if (!updated) return Response.json({ error: 'not_found' }, { status: 404 })
    return Response.json({ flow: serializeFlowDetail(updated, user) })
  },
)

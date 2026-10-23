import { auditEvent } from '@/lib/auth'
import { CONNECTOR_GATEWAY_TTL_SECONDS, issueConnectorGatewayToken } from '@/lib/connectors/gateway-tokens'
import { authenticateWorkspace } from '@/lib/security/workspace-auth'
import { connectorService, userService } from '@/lib/services'

export const runtime = 'nodejs'

export async function POST(request: Request, context: { params: Promise<{ id: string }> }): Promise<Response> {
  const { id } = await context.params
  const slug = new URL(request.url).searchParams.get('workspace') ?? ''
  const identity = await authenticateWorkspace(request, slug)
  if (!identity) return Response.json({ error: 'unauthorized' }, { status: 401 })
  const user = await userService.findIdBySlug(slug)
  if (!user || !await connectorService.findEnabledByIdAndUserId(id, user.id)) {
    return Response.json({ error: 'unauthorized' }, { status: 401 })
  }
  const token = issueConnectorGatewayToken({ userId: user.id, workspaceSlug: slug, connectorId: id, credentialEpoch: identity.credentialEpoch })
  await auditEvent({ actorUserId: user.id, action: 'connector.gateway_token_issued', metadata: { connectorId: id, slug } })
  return Response.json({ token, expiresAt: Math.floor(Date.now() / 1000) + CONNECTOR_GATEWAY_TTL_SECONDS }, {
    headers: { 'Cache-Control': 'no-store' },
  })
}

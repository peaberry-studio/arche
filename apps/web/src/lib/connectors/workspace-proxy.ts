import { createHmac } from 'node:crypto'

import { instanceService } from '@/lib/services'
import { decryptPassword } from '@/lib/spawner/crypto'

export async function getConnectorProxyTarget(slug: string, connectorId: string, port: number): Promise<{ url: string; token: string }> {
  const instance = await instanceService.findCredentialsBySlug(slug)
  if (!instance) throw new Error('workspace_credentials_unavailable')
  const token = createHmac('sha256', decryptPassword(instance.serverPassword))
    .update(`arche-connector-proxy:${connectorId}`).digest('base64url')
  return { url: `http://127.0.0.1:${port}/mcp/connectors/${connectorId}`, token }
}

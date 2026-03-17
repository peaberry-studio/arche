import { instanceService } from '@/lib/services'
import { getRuntimeCapabilities } from '@/lib/runtime/capabilities'
import { decryptPassword } from '@/lib/spawner/crypto'
import { getWorkspaceAgentPort } from '@/lib/spawner/config'

const DEFAULT_USERNAME = 'opencode'
const DESKTOP_LOOPBACK_HOST = '127.0.0.1'
const DESKTOP_WORKSPACE_AGENT_PORT_ENV = 'ARCHE_DESKTOP_WORKSPACE_AGENT_PORT'

function getDesktopWorkspaceAgentPort(): number {
  const raw = process.env[DESKTOP_WORKSPACE_AGENT_PORT_ENV]
  const parsed = raw ? Number(raw) : Number.NaN
  return Number.isFinite(parsed) && parsed > 0 ? parsed : getWorkspaceAgentPort()
}

export function getWorkspaceAgentUrl(slug: string): string {
  const caps = getRuntimeCapabilities()
  const host = caps.containers ? `opencode-${slug}` : DESKTOP_LOOPBACK_HOST
  const port = caps.containers ? getWorkspaceAgentPort() : getDesktopWorkspaceAgentPort()
  return `http://${host}:${port}`
}

export async function createWorkspaceAgentClient(slug: string): Promise<{
  baseUrl: string
  authHeader: string
} | null> {
  const instance = await instanceService.findCredentialsBySlug(slug)

  if (!instance || !instance.serverPassword || instance.status !== 'running') {
    return null
  }

  try {
    const password = decryptPassword(instance.serverPassword)
    const authHeader = `Basic ${Buffer.from(`${DEFAULT_USERNAME}:${password}`).toString('base64')}`
    return {
      baseUrl: getWorkspaceAgentUrl(slug),
      authHeader
    }
  } catch {
    console.error(`[workspace-agent] Failed to decrypt password for ${slug}`)
    return null
  }
}

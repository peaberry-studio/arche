import { instanceService } from '@/lib/services'
import { decryptPassword } from '@/lib/spawner/crypto'
import { getWorkspaceAgentPort } from '@/lib/spawner/config'

const DEFAULT_USERNAME = 'opencode'

export function getWorkspaceAgentUrl(slug: string): string {
  const containerName = `opencode-${slug}`
  const port = getWorkspaceAgentPort()
  return `http://${containerName}:${port}`
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

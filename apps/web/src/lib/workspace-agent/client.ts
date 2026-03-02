import { prisma } from '@/lib/prisma'
import { decryptPassword } from '@/lib/spawner/crypto'
import {
  getLocalInstanceHost,
  getSpawnerBackend,
  getWorkspaceAgentPortForSlug,
} from '@/lib/spawner/config'

const DEFAULT_USERNAME = 'opencode'

export function getWorkspaceAgentUrl(slug: string): string {
  const port = getWorkspaceAgentPortForSlug(slug)
  if (getSpawnerBackend() === 'local') {
    const host = getLocalInstanceHost()
    return `http://${host}:${port}`
  }

  const containerName = `opencode-${slug}`
  return `http://${containerName}:${port}`
}

export async function createWorkspaceAgentClient(slug: string): Promise<{
  baseUrl: string
  authHeader: string
} | null> {
  const instance = await prisma.instance.findUnique({
    where: { slug },
    select: { serverPassword: true, status: true }
  })

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

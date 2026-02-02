/**
 * OpenCode client factory for communicating with OpenCode instances.
 * 
 * Each user has their own OpenCode container running on the internal container network.
 * The web app acts as a proxy/BFF, authenticating and forwarding requests.
 */

import { createOpencodeClient, type OpencodeClient } from '@opencode-ai/sdk/v2/client'
import { prisma } from '@/lib/prisma'
import { decryptPassword } from '@/lib/spawner/crypto'
import { getOpencodeNetwork } from '@/lib/spawner/config'

const OPENCODE_PORT = 4096

/**
 * Get the internal network URL for an OpenCode instance.
 * Container names follow the pattern: opencode-{slug}
 */
export function getInstanceUrl(slug: string): string {
  const containerName = `opencode-${slug}`
  // When running in a container network, containers communicate via container name
  // When running locally for dev, we might need to use localhost
  const isContainer = process.env.CONTAINER_PROXY_HOST !== undefined || process.env.CONTAINER_SOCKET_PATH !== undefined

  if (isContainer) {
    return `http://${containerName}:${OPENCODE_PORT}`
  }

  // For local development without containers, you'd need to map ports
  // This is a fallback - in production, always use container networking
  return `http://localhost:${OPENCODE_PORT}`
}

/**
 * Get credentials for authenticating with an OpenCode instance.
 */
async function getInstanceCredentials(slug: string): Promise<{ username: string; password: string } | null> {
  const instance = await prisma.instance.findUnique({
    where: { slug },
    select: { serverPassword: true, status: true }
  })
  
  if (!instance || !instance.serverPassword || instance.status !== 'running') {
    return null
  }
  
  try {
    const password = decryptPassword(instance.serverPassword)
    return {
      username: 'opencode',
      password
    }
  } catch {
    console.error(`[opencode/client] Failed to decrypt password for ${slug}`)
    return null
  }
}

/**
 * Create an authenticated OpenCode client for a specific user's instance.
 * Returns null if the instance is not running or credentials are unavailable.
 */
export async function createInstanceClient(slug: string): Promise<OpencodeClient | null> {
  const credentials = await getInstanceCredentials(slug)
  if (!credentials) {
    console.log(`[opencode/client] No credentials for ${slug}`)
    return null
  }
  
  const baseUrl = getInstanceUrl(slug)
  console.log(`[opencode/client] Creating client for ${slug} at ${baseUrl}`)
  
  const authHeader = `Basic ${Buffer.from(`${credentials.username}:${credentials.password}`).toString('base64')}`
  
  const client = createOpencodeClient({
    baseUrl,
    fetch: async (input, init) => {
      const headers = new Headers(init?.headers)
      headers.set('Authorization', authHeader)
      const url = typeof input === 'string' ? input : input instanceof Request ? input.url : input.toString()
      console.log(`[opencode/client] ${init?.method ?? 'GET'} ${url}`)
      try {
        const response = await fetch(input, { ...init, headers })
        console.log(`[opencode/client] Response: ${response.status}`)
        return response
      } catch (err) {
        console.error(`[opencode/client] Fetch error:`, err)
        throw err
      }
    }
  })
  
  return client
}

/**
 * Check if an OpenCode instance is healthy using explicit credentials.
 */
export async function isInstanceHealthyWithPassword(slug: string, password: string): Promise<boolean> {
  const baseUrl = getInstanceUrl(slug)
  const authHeader = `Basic ${Buffer.from(`opencode:${password}`).toString('base64')}`

  try {
    const response = await fetch(`${baseUrl}/global/health`, {
      headers: {
        Authorization: authHeader,
        Accept: 'application/json',
      },
      cache: 'no-store',
    })

    if (!response.ok) return false

    const data = await response.json().catch(() => null)
    return data?.healthy === true
  } catch {
    return false
  }
}

/**
 * Check if an OpenCode instance is healthy and responding.
 */
export async function isInstanceHealthy(slug: string): Promise<boolean> {
  const client = await createInstanceClient(slug)
  if (!client) return false
  
  try {
    const result = await client.global.health()
    return result.data?.healthy === true
  } catch {
    return false
  }
}

export type { OpencodeClient }

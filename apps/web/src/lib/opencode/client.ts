/**
 * OpenCode client factory for communicating with OpenCode instances.
 * 
 * Each user has their own OpenCode container running on the internal container network.
 * The web app acts as a proxy/BFF, authenticating and forwarding requests.
 */

import { createOpencodeClient, type OpencodeClient } from '@opencode-ai/sdk/v2/client'

import { instanceService } from '@/lib/services'
import { decryptPassword } from '@/lib/spawner/crypto'
import { getRuntimeCapabilities } from '@/lib/runtime/capabilities'

const OPENCODE_PORT = 4096
const DESKTOP_LOOPBACK_HOST = '127.0.0.1'

/**
 * Get the internal network URL for an OpenCode instance.
 * Container names follow the pattern: opencode-{slug}
 * In desktop mode, use the IPv4 loopback address instead of container hostname.
 */
export function getInstanceUrl(slug: string): string {
  const caps = getRuntimeCapabilities()
  const host = caps.containers ? `opencode-${slug}` : DESKTOP_LOOPBACK_HOST
  return `http://${host}:${OPENCODE_PORT}`
}

/**
 * Get credentials for authenticating with an OpenCode instance.
 */
async function getInstanceCredentials(slug: string): Promise<{ username: string; password: string } | null> {
  const instance = await instanceService.findCredentialsBySlug(slug)
  
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

export async function getInstanceBasicAuth(
  slug: string,
): Promise<{ baseUrl: string; authHeader: string } | null> {
  const credentials = await getInstanceCredentials(slug)
  if (!credentials) return null

  const baseUrl = getInstanceUrl(slug)
  const authHeader = `Basic ${Buffer.from(`${credentials.username}:${credentials.password}`).toString('base64')}`
  return { baseUrl, authHeader }
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
      // The SDK may pass a fully-formed Request object as `input` with
      // method, headers and body already set (and `init` undefined).
      // We must preserve all of those while injecting the auth header.
      const isRequest = input instanceof Request
      const method = init?.method ?? (isRequest ? input.method : 'GET')
      const mergedHeaders = new Headers(isRequest ? input.headers : undefined)
      if (init?.headers) {
        const extra = new Headers(init.headers)
        extra.forEach((value, key) => mergedHeaders.set(key, value))
      }
      mergedHeaders.set('Authorization', authHeader)

      const url = typeof input === 'string' ? input : input instanceof Request ? input.url : input.toString()
      console.log(`[opencode/client] ${method} ${url}`)
      try {
        const response = await fetch(url, {
          ...init,
          method,
          headers: mergedHeaders,
          body: init?.body ?? (isRequest ? input.body : undefined),
          // @ts-expect-error -- Node/undici duplex hint for streaming bodies
          duplex: (init?.body ?? (isRequest ? input.body : undefined)) ? 'half' : undefined,
        })
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

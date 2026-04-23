/**
 * OpenCode client factory for communicating with OpenCode instances.
 * 
 * Each user has their own OpenCode container running on the internal container network.
 * The web app acts as a proxy/BFF, authenticating and forwarding requests.
 */

import type { OpencodeClient } from '@opencode-ai/sdk/v2/client'

import { createConfiguredOpencodeClient } from '@/lib/opencode/client-factory'
import {
  getInstanceUrl as resolveInstanceUrl,
  resolveInstanceConnection,
} from '@/lib/opencode/connection-resolver'

export { getInstanceBasicAuth, getInstanceUrl } from '@/lib/opencode/connection-resolver'

/**
 * Create an authenticated OpenCode client for a specific user's instance.
 * Returns null if the instance is not running or credentials are unavailable.
 */
export async function createInstanceClient(slug: string): Promise<OpencodeClient | null> {
  const connection = await resolveInstanceConnection(slug)
  if (!connection) {
    return null
  }

  return createConfiguredOpencodeClient(connection)
}

/**
 * Check if an OpenCode instance is healthy using explicit credentials.
 */
export async function isInstanceHealthyWithPassword(slug: string, password: string): Promise<boolean> {
  const baseUrl = resolveInstanceUrl(slug)
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

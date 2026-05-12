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

export type InstanceHealthResult =
  | { ok: true }
  | { ok: false; detail: string; message?: string }

function getErrorMessage(error: unknown): string | undefined {
  if (error instanceof Error) {
    return error.message
  }

  return typeof error === 'string' ? error : undefined
}

function getErrorCode(error: unknown): string | undefined {
  if (!error || typeof error !== 'object') {
    return undefined
  }

  const record = error as { cause?: unknown; code?: unknown }
  if (typeof record.code === 'string') {
    return record.code
  }

  if (record.cause && typeof record.cause === 'object') {
    const cause = record.cause as { code?: unknown }
    if (typeof cause.code === 'string') {
      return cause.code
    }
  }

  return undefined
}

function describeFetchError(error: unknown): { detail: string; message?: string } {
  const code = getErrorCode(error)
  const message = getErrorMessage(error)
  if (code === 'ENOTFOUND') {
    return { detail: 'dns_resolution_error', message }
  }

  if (code === 'ECONNREFUSED') {
    return { detail: 'connection_refused', message }
  }

  if (code === 'ETIMEDOUT' || code === 'UND_ERR_CONNECT_TIMEOUT') {
    return { detail: 'connect_timeout', message }
  }

  return { detail: code ?? 'fetch_failed', message }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
}

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
export async function isInstanceHealthyWithPassword(
  slug: string,
  password: string,
  overrideBaseUrl?: string,
): Promise<InstanceHealthResult> {
  const baseUrl = resolveInstanceUrl(slug, overrideBaseUrl)
  const authHeader = `Basic ${Buffer.from(`opencode:${password}`).toString('base64')}`

  try {
    const response = await fetch(`${baseUrl}/global/health`, {
      headers: {
        Authorization: authHeader,
        Accept: 'application/json',
      },
      cache: 'no-store',
    })

    if (!response.ok) {
      return {
        ok: false,
        detail: `http_status_${response.status}`,
        ...(response.statusText ? { message: response.statusText } : {}),
      }
    }

    let data: unknown
    try {
      data = await response.json()
    } catch (error) {
      return { ok: false, detail: 'invalid_json', message: getErrorMessage(error) }
    }

    if (isRecord(data) && data.healthy === true) {
      return { ok: true }
    }

    return { ok: false, detail: 'unhealthy_response', message: JSON.stringify(data) }
  } catch (error) {
    return { ok: false, ...describeFetchError(error) }
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

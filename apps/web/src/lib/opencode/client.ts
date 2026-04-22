/**
 * OpenCode client factory for communicating with OpenCode instances.
 * 
 * Each user has their own OpenCode container running on the internal container network.
 * The web app acts as a proxy/BFF, authenticating and forwarding requests.
 */

import { createOpencodeClient, type OpencodeClient } from '@opencode-ai/sdk/v2/client'

import { getE2eRuntimeConnection, isE2eFakeRuntimeEnabled } from '@/lib/e2e/runtime'
import { getRuntimeCapabilities } from '@/lib/runtime/capabilities'
import { instanceService } from '@/lib/services'
import { decryptPassword } from '@/lib/spawner/crypto'

const DEFAULT_OPENCODE_PORT = 4096
const DESKTOP_LOOPBACK_HOST = '127.0.0.1'
const DESKTOP_OPENCODE_PORT_ENV = 'ARCHE_DESKTOP_OPENCODE_PORT'

function getDesktopOpencodePort(): number {
  const raw = process.env[DESKTOP_OPENCODE_PORT_ENV]
  const parsed = raw ? Number(raw) : Number.NaN
  return Number.isFinite(parsed) && parsed > 0 ? parsed : DEFAULT_OPENCODE_PORT
}

/**
 * Get the internal network URL for an OpenCode instance.
 * Container names follow the pattern: opencode-{slug}
 * In desktop mode, use the IPv4 loopback address instead of container hostname.
 */
export function getInstanceUrl(slug: string, overrideBaseUrl?: string): string {
  const e2eConnection = getE2eRuntimeConnection(overrideBaseUrl)
  if (e2eConnection) {
    return e2eConnection.baseUrl
  }

  if (overrideBaseUrl) {
    return overrideBaseUrl
  }

  const caps = getRuntimeCapabilities()
  const host = caps.containers ? `opencode-${slug}` : DESKTOP_LOOPBACK_HOST
  const port = caps.containers ? DEFAULT_OPENCODE_PORT : getDesktopOpencodePort()
  return `http://${host}:${port}`
}

/**
 * Get credentials for authenticating with an OpenCode instance.
 */
async function getInstanceCredentials(slug: string): Promise<{ username: string; password: string } | null> {
  const instance = await instanceService.findCredentialsBySlug(slug)
  
  if (!instance || !instance.serverPassword || instance.status !== 'running') {
    return null
  }

  if (isE2eFakeRuntimeEnabled()) {
    const connection = getE2eRuntimeConnection()
    if (!connection) {
      return null
    }

    return {
      username: 'opencode',
      password: connection.password,
    }
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

  if (isE2eFakeRuntimeEnabled()) {
    return createE2eFakeClient(baseUrl, authHeader)
  }
  
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

type E2eSessionRecord = {
  createdAt?: number
  id?: string
  status?: string
  title?: string
  updatedAt?: number
}

type E2eMessageRecord = {
  createdAt?: number
  id?: string
  role?: string
  sessionId?: string
  text?: string
}

async function fetchE2eRuntimeJson<T>(
  baseUrl: string,
  authHeader: string,
  path: string,
  init?: RequestInit,
): Promise<T> {
  const response = await fetch(`${baseUrl}${path}`, {
    ...init,
    headers: {
      Authorization: authHeader,
      Accept: 'application/json',
      ...(init?.body ? { 'Content-Type': 'application/json' } : {}),
      ...(init?.headers ? Object.fromEntries(new Headers(init.headers).entries()) : {}),
    },
  })

  if (!response.ok) {
    throw new Error(`HTTP ${response.status}`)
  }

  return response.json() as Promise<T>
}

function mapE2eSession(session: E2eSessionRecord | undefined) {
  return {
    id: session?.id ?? '',
    title: session?.title ?? session?.id ?? 'Untitled',
    parentID: null,
    time: {
      created: session?.createdAt,
      updated: session?.updatedAt,
    },
  }
}

function listFilesAtPath(files: Array<{ hash?: string; modifiedAt?: number; path?: string; size?: number }>, path: string) {
  const normalizedPath = path.replace(/^\/+|\/+$/g, '')
  const entries = new Map<string, {
    hash?: string
    ignored: boolean
    modifiedAt?: number
    name: string
    path: string
    size?: number
    type: 'directory' | 'file'
  }>()

  for (const file of files) {
    const filePath = file.path?.replace(/^\/+|\/+$/g, '')
    if (!filePath) {
      continue
    }

    const parts = filePath.split('/')
    const parentParts = normalizedPath ? normalizedPath.split('/') : []

    if (parentParts.length > parts.length || !parentParts.every((part, index) => parts[index] === part)) {
      continue
    }

    const remainder = parts.slice(parentParts.length)
    if (remainder.length === 0) {
      continue
    }

    if (remainder.length === 1) {
      entries.set(filePath, {
        hash: file.hash,
        ignored: false,
        modifiedAt: file.modifiedAt,
        name: remainder[0],
        path: filePath,
        size: file.size,
        type: 'file',
      })
      continue
    }

    const directoryPath = [...parentParts, remainder[0]].join('/')
    if (!entries.has(directoryPath)) {
      entries.set(directoryPath, {
        ignored: false,
        name: remainder[0],
        path: directoryPath,
        type: 'directory',
      })
    }
  }

  return Array.from(entries.values()).sort((left, right) => left.path.localeCompare(right.path))
}

function createE2eFakeClient(baseUrl: string, authHeader: string): OpencodeClient {
  const client = {
    global: {
      health: async () => {
        const data = await fetchE2eRuntimeJson<{ version?: string }>(baseUrl, authHeader, '/__e2e/health')
        return { data: { healthy: true, version: data.version ?? 'e2e-fake-runtime' } }
      },
    },
    session: {
      list: async () => {
        const response = await fetchE2eRuntimeJson<{ sessions?: E2eSessionRecord[] }>(baseUrl, authHeader, '/__e2e/sessions')
        return { data: (response.sessions ?? []).map((session) => mapE2eSession(session)) }
      },
      create: async (parameters?: { title?: string }) => {
        const response = await fetchE2eRuntimeJson<{ session?: E2eSessionRecord }>(
          baseUrl,
          authHeader,
          '/__e2e/sessions',
          {
            method: 'POST',
            body: JSON.stringify({ title: parameters?.title }),
          },
        )
        return { data: response.session ? mapE2eSession(response.session) : null }
      },
      update: async (parameters: { sessionID: string; title?: string }) => {
        const response = await fetchE2eRuntimeJson<{ session?: E2eSessionRecord }>(
          baseUrl,
          authHeader,
          `/__e2e/sessions/${parameters.sessionID}`,
          {
            method: 'PATCH',
            body: JSON.stringify({ title: parameters.title }),
          },
        )
        return { data: response.session ? mapE2eSession(response.session) : null }
      },
      delete: async (parameters: { sessionID: string }) => {
        await fetchE2eRuntimeJson(baseUrl, authHeader, `/__e2e/sessions/${parameters.sessionID}`, {
          method: 'DELETE',
        })
        return { data: null }
      },
      messages: async (parameters: { sessionID: string }) => {
        const response = await fetchE2eRuntimeJson<{ messages?: E2eMessageRecord[] }>(
          baseUrl,
          authHeader,
          `/__e2e/sessions/${parameters.sessionID}/messages`,
        )

        return {
          data: (response.messages ?? []).map((message) => ({
            info: {
              id: message.id ?? '',
              role: message.role,
              sessionID: message.sessionId ?? parameters.sessionID,
              ...(message.role === 'assistant'
                ? {
                    agent: 'assistant',
                    modelID: 'e2e-model',
                    providerID: 'e2e-provider',
                  }
                : {}),
              time: { created: message.createdAt },
            },
            parts: [{ type: 'text', text: message.text ?? '' }],
          })),
        }
      },
      status: async () => {
        const response = await fetchE2eRuntimeJson<{ sessions?: Array<{ id?: string; status?: string }> }>(
          baseUrl,
          authHeader,
          '/__e2e/sessions/status',
        )

        const data = Object.fromEntries(
          (response.sessions ?? [])
            .filter((session): session is { id: string; status?: string } => typeof session.id === 'string')
            .map((session) => [session.id, { type: session.status === 'busy' ? 'busy' : 'idle' }]),
        )

        return { data }
      },
    },
    file: {
      list: async (parameters?: { path?: string }) => {
        const response = await fetchE2eRuntimeJson<{
          files?: Array<{ hash?: string; modifiedAt?: number; path?: string; size?: number }>
        }>(baseUrl, authHeader, '/__e2e/files')
        return { data: listFilesAtPath(response.files ?? [], parameters?.path ?? '') }
      },
    },
    config: {
      providers: async () => {
        const response = await fetchE2eRuntimeJson<{
          providers?: Array<{ id?: string; name?: string }>
        }>(baseUrl, authHeader, '/__e2e/providers')

        return {
          data: {
            default: { 'e2e-provider': 'e2e-model' },
            providers: (response.providers ?? []).map((provider) => ({
              id: provider.id ?? 'e2e-provider',
              name: provider.name ?? 'E2E Provider',
              models: {
                'e2e-model': {
                  cost: { input: 0, output: 0 },
                  name: 'E2E Model',
                },
              },
            })),
          },
        }
      },
    },
    app: {
      agents: async () => {
        const response = await fetchE2eRuntimeJson<{
          agents?: Array<{ id?: string; name?: string; description?: string }>
        }>(baseUrl, authHeader, '/__e2e/agents')

        return {
          data: (response.agents ?? []).map((agent) => ({
            name: agent.id ?? agent.name ?? 'assistant',
            description: agent.description ?? agent.name,
          })),
        }
      },
    },
  }

  // E2E fake runtime only implements the client subset Arche exercises in those flows.
  return client as unknown as OpencodeClient
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

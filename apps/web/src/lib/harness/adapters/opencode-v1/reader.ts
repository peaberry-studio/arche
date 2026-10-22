import type { OpencodeClient } from '@opencode-ai/sdk/v2/client'

import { isInstanceHealthyWithPassword } from '@/lib/harness/adapters/opencode-v1/client'
import { createConfiguredOpencodeClient } from '@/lib/harness/adapters/opencode-v1/client-factory'
import { toHarnessMessage, toHarnessSession } from '@/lib/harness/adapters/opencode-v1/transform'
import type { HarnessSession, HarnessSessionStatus, LegacySessionReader } from '@/lib/harness/contract'
import { harnessFailure, type HarnessResult } from '@/lib/harness/errors'
import { DEFAULT_HEALTH_TIMEOUT_MS } from '@/lib/harness/runtime-connection'
import { getString, isRecord } from '@/lib/records'

type Connection = { baseUrl: string; authHeader: string; signal?: AbortSignal }

function normalizeOpenCodeError(error: unknown): ReturnType<typeof harnessFailure> {
  const record = isRecord(error) ? error : {}
  const response = isRecord(record.response) ? record.response : {}
  const cause = isRecord(record.cause) ? record.cause : {}
  const parsedStatus = Number(record.status ?? record.statusCode ?? response.status ?? response.statusCode ?? cause.status)
  const status = Number.isFinite(parsedStatus) ? parsedStatus : undefined
  const detail = error instanceof Error ? error.message : typeof error === 'string' ? error :
    getString(record.message) ?? getString(response.statusText) ?? getString(cause.message)
  if (status === 404 || /session.*not\s*found|session_not_found/i.test(`${getString(record.code) ?? ''} ${detail ?? ''}`)) {
    return harnessFailure('session_not_found', detail, status)
  }
  if (status === 409) return harnessFailure('session_busy', detail, status)
  return harnessFailure('runtime_error', detail, status)
}

function requireSession(value: unknown): HarnessSession {
  const session = toHarnessSession(value)
  if (!session) throw new Error('Invalid session response')
  return session
}

function normalizeHealthFailure(detail: string, message?: string): ReturnType<typeof harnessFailure> {
  switch (detail) {
    case 'healthcheck_timeout':
    case 'dns_resolution_error':
    case 'connection_refused':
    case 'connect_timeout':
    case 'fetch_failed':
    case 'invalid_json':
    case 'unhealthy_response':
      return harnessFailure(detail, message)
    default:
      if (/^http_status_\d+$/.test(detail)) return harnessFailure(`http_status_${Number(detail.slice('http_status_'.length))}`, message)
      return harnessFailure('runtime_error', message ?? detail)
  }
}

// Reads conversations from an OpenCode 1 server (a running legacy container or
// the temporary archive helper) so they can be archived. It never writes.
export function createOpenCodeV1Reader(slug: string, connection: Connection): LegacySessionReader {
  async function withClient<T>(work: (client: OpencodeClient) => Promise<T>): Promise<HarnessResult<T>> {
    try {
      const signal = AbortSignal.any([AbortSignal.timeout(60_000), ...(connection.signal ? [connection.signal] : [])])
      return { ok: true, data: await work(await createConfiguredOpencodeClient({ ...connection, signal })) }
    } catch (error) {
      return normalizeOpenCodeError(error)
    }
  }

  return {
    slug,
    async health(options) {
      if (options?.password !== undefined) {
        const result = await isInstanceHealthyWithPassword(slug, options.password, options.baseUrl ?? connection.baseUrl, options)
        return result.ok ? { ok: true, data: {} } : normalizeHealthFailure(result.detail, result.message)
      }
      const signal = AbortSignal.any([AbortSignal.timeout(options?.timeoutMs ?? DEFAULT_HEALTH_TIMEOUT_MS), ...(options?.signal ? [options.signal] : [])])
      const result = await withClient(async (client) => (await client.global.health({ signal, throwOnError: true })).data)
      if (signal.aborted) return harnessFailure('healthcheck_timeout')
      if (!result.ok) return result
      return result.data?.healthy ? { ok: true, data: { version: result.data.version } } : harnessFailure('unhealthy_response')
    },
    getSession: (sessionId) => withClient(async (client) => requireSession((await client.session.get({ sessionID: sessionId }, { throwOnError: true })).data)),
    listSessions: (options = {}) => withClient(async (client) => (await client.session.list({ limit: options.limit, roots: options.rootsOnly, start: options.start }, { throwOnError: true })).data.map(requireSession)),
    listChildren: (sessionId) => withClient(async (client) => (await client.session.children({ sessionID: sessionId }, { throwOnError: true })).data.map(requireSession)),
    sessionStatus: (options) => withClient(async (client) => {
      const response = await client.session.status({}, { throwOnError: true, ...options })
      // Anything not idle (busy, retrying) is still running for archive purposes.
      return Object.fromEntries(Object.entries(response.data).map(([id, value]): [string, HarnessSessionStatus] => [id, { type: value.type === 'idle' ? 'idle' : 'busy' }]))
    }),
    listMessages: (sessionId, options) => withClient(async (client) => {
      const response = await client.session.messages({ sessionID: sessionId }, { throwOnError: true, ...options })
      return response.data.flatMap((message) => {
        const normalized = toHarnessMessage({ ...message.info, sessionID: sessionId, parts: message.parts })
        return normalized ? [normalized] : []
      })
    }),
  }
}

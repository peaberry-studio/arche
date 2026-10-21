import { OpenCode } from '@opencode/client'

import { getInstanceBasicAuth, getInstanceUrl } from '@/lib/harness/adapters/opencode-v1/connection-resolver'
import type { HarnessHealthOptions } from '@/lib/harness/contract'
import { harnessFailure, type HarnessResult } from '@/lib/harness/errors'
import { getString, isRecord } from '@/lib/records'

export { getInstanceBasicAuth } from '@/lib/harness/adapters/opencode-v1/connection-resolver'

export type OpenCodeV2Client = ReturnType<typeof OpenCode.make>

export function normalizeOpenCodeError(error: unknown): ReturnType<typeof harnessFailure> {
  const value = isRecord(error) ? error : {}
  const tag = getString(value._tag) ?? getString(value.name)
  const detail = getString(value.message) ?? tag ?? 'OpenCode V2 request failed'
  const cause = isRecord(value.cause) ? value.cause : {}
  const transport = isRecord(cause.cause) ? cause.cause : cause
  if (tag === 'SessionNotFoundError') return harnessFailure('session_not_found', detail, 404)
  if (tag === 'SessionBusyError') return harnessFailure('session_busy', detail, 409)
  if (value.reason === 'UnexpectedStatus' && typeof cause.status === 'number') return harnessFailure(`http_status_${cause.status}`, detail, cause.status)
  if (value.reason === 'Transport') {
    const code = getString(transport.code)
    if (code === 'ENOTFOUND') return harnessFailure('dns_resolution_error', detail)
    if (code === 'ECONNREFUSED') return harnessFailure('connection_refused', detail)
    if (code === 'ETIMEDOUT' || code === 'UND_ERR_CONNECT_TIMEOUT') return harnessFailure('connect_timeout', detail)
    return harnessFailure('fetch_failed', detail)
  }
  return harnessFailure('runtime_error', detail)
}

export function createConnectionClient(connection: { baseUrl: string; authHeader: string }): OpenCodeV2Client {
  return OpenCode.make({ baseUrl: connection.baseUrl, headers: { Authorization: connection.authHeader } })
}

export async function createInstanceClient(slug: string): Promise<OpenCodeV2Client | null> {
  const connection = await getInstanceBasicAuth(slug)
  return connection ? createConnectionClient(connection) : null
}

export async function checkHealth(slug: string, options?: HarnessHealthOptions): Promise<HarnessResult<{ version?: string }>> {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), options?.timeoutMs ?? 5000)
  const abort = () => controller.abort()
  options?.signal?.addEventListener('abort', abort, { once: true })
  if (options?.signal?.aborted) controller.abort()
  try {
    const connection = options?.password !== undefined ? {
      baseUrl: getInstanceUrl(slug, options.baseUrl),
      authHeader: `Basic ${Buffer.from(`opencode:${options.password}`).toString('base64')}`,
    } : await getInstanceBasicAuth(slug)
    if (!connection) return harnessFailure('instance_unavailable')
    const client = createConnectionClient(connection)
    const info = await client.server.info({ signal: controller.signal })
    if (controller.signal.aborted) return harnessFailure('healthcheck_timeout')
    if (!info.version.startsWith('2.') || !Number.isFinite(info.pid) || !Array.isArray(info.urls)) return harnessFailure('unhealthy_response')
    return { ok: true, data: { version: info.version } }
  } catch (error) {
    return controller.signal.aborted ? harnessFailure('healthcheck_timeout') : normalizeOpenCodeError(error)
  } finally {
    clearTimeout(timer)
    options?.signal?.removeEventListener('abort', abort)
  }
}

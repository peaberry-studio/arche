/**
 * Health probe for an OpenCode 1 server, used only by the legacy history reader.
 */

import { DEFAULT_HEALTH_TIMEOUT_MS, getInstanceUrl as resolveInstanceUrl } from '@/lib/harness/runtime-connection'

export type InstanceHealthResult =
  | { ok: true }
  | { ok: false; detail: string; message?: string }

export type InstanceHealthOptions = {
  timeoutMs?: number
  signal?: AbortSignal
}

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
 * Check if an OpenCode instance is healthy using explicit credentials.
 *
 * Every request carries an `AbortController` that fires at `timeoutMs`
 * (default `DEFAULT_HEALTH_TIMEOUT_MS`), so a hanging or idle connection can
 * never outlive the deadline. An external `options.signal` can additionally
 * cancel the request from the caller (used to cancel the losing probe when a
 * concurrent probe confirms health).
 */
export async function isInstanceHealthyWithPassword(
  slug: string,
  password: string,
  overrideBaseUrl?: string,
  options?: InstanceHealthOptions,
): Promise<InstanceHealthResult> {
  const baseUrl = resolveInstanceUrl(slug, overrideBaseUrl)
  const authHeader = `Basic ${Buffer.from(`opencode:${password}`).toString('base64')}`
  const timeoutMs = options?.timeoutMs ?? DEFAULT_HEALTH_TIMEOUT_MS

  const controller = new AbortController()
  const timeoutTimer = setTimeout(() => controller.abort(), timeoutMs)
  const onExternalAbort = () => controller.abort()
  options?.signal?.addEventListener('abort', onExternalAbort, { once: true })
  if (options?.signal?.aborted) controller.abort()

  try {
    const response = await fetch(`${baseUrl}/global/health`, {
      headers: {
        Authorization: authHeader,
        Accept: 'application/json',
      },
      cache: 'no-store',
      signal: controller.signal,
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
    if (controller.signal.aborted) {
      return { ok: false, detail: 'healthcheck_timeout' }
    }
    return { ok: false, ...describeFetchError(error) }
  } finally {
    clearTimeout(timeoutTimer)
    options?.signal?.removeEventListener('abort', onExternalAbort)
  }
}

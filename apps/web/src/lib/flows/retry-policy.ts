const DEFAULT_MAX_ATTEMPTS = 5
const DEFAULT_RETRY_BACKOFF_MS = [60_000, 120_000, 300_000, 600_000, 900_000]
const FLOW_RETRY_BACKOFF_ENV = 'ARCHE_FLOW_RETRY_BACKOFF_MS'
const FLOW_RETRY_MAX_ATTEMPTS_ENV = 'ARCHE_FLOW_RETRY_MAX_ATTEMPTS'

let warnedInvalidRetryBackoffValue: string | null = null

export type FlowRetryPlan =
  | {
      ok: true
      maxAttempts: number
      nextAttempt: number
      retryAt: Date
    }
  | {
      ok: false
      maxAttempts: number
      reason: 'non_retryable_error' | 'retry_exhausted'
    }

function parsePositiveInteger(value: string | undefined, fallback: number): number {
  const parsed = value ? Number(value) : Number.NaN
  return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback
}

export function getFlowMaxRetryAttempts(): number {
  return parsePositiveInteger(process.env[FLOW_RETRY_MAX_ATTEMPTS_ENV], DEFAULT_MAX_ATTEMPTS)
}

export function getFlowRetryBackoffMs(): number[] {
  const raw = process.env[FLOW_RETRY_BACKOFF_ENV]
  if (!raw) return DEFAULT_RETRY_BACKOFF_MS

  const invalidValues: string[] = []
  const values = raw.split(',').flatMap((value) => {
    const trimmed = value.trim()
    const parsed = Number(trimmed)
    if (Number.isFinite(parsed) && parsed > 0) return [parsed]

    invalidValues.push(trimmed)
    return []
  })

  if (invalidValues.length > 0 && warnedInvalidRetryBackoffValue !== raw) {
    warnedInvalidRetryBackoffValue = raw
    console.warn('[flows] Invalid retry backoff configuration entries ignored', {
      env: FLOW_RETRY_BACKOFF_ENV,
      invalidValues,
      value: raw,
    })
  }

  return values.length > 0 ? values : DEFAULT_RETRY_BACKOFF_MS
}

export function isRetryableFlowRunError(error: string): boolean {
  const normalized = error.toLowerCase()
  return (
    normalized.includes('healthcheck timeout') ||
    normalized.includes('instance_start_timeout') ||
    normalized.includes('instance_unavailable') ||
    normalized.includes('flow_mcp_connector_unavailable') ||
    normalized.includes('kb_unavailable') ||
    normalized.includes('user_data_unavailable') ||
    normalized.includes('fetch failed') ||
    normalized.includes('econnrefused') ||
    normalized.includes('enotfound') ||
    normalized.includes('und_err_connect_timeout') ||
    normalized.includes('dns_resolution') ||
    normalized.includes('connection_refused') ||
    normalized.includes('connect_timeout') ||
    normalized.includes('name is already in use') ||
    (normalized.includes('container name') && normalized.includes('already in use'))
  )
}

export function planFlowRetry(params: {
  attempt: number
  error: string
  now: Date
}): FlowRetryPlan {
  const maxAttempts = getFlowMaxRetryAttempts()
  if (!isRetryableFlowRunError(params.error)) {
    return { ok: false, maxAttempts, reason: 'non_retryable_error' }
  }

  if (params.attempt >= maxAttempts) {
    return { ok: false, maxAttempts, reason: 'retry_exhausted' }
  }

  const backoffs = getFlowRetryBackoffMs()
  const backoffMs = backoffs[params.attempt - 1] ?? backoffs[backoffs.length - 1] ?? DEFAULT_RETRY_BACKOFF_MS[0]

  return {
    ok: true,
    maxAttempts,
    nextAttempt: params.attempt + 1,
    retryAt: new Date(params.now.getTime() + backoffMs),
  }
}

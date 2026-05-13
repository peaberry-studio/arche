const DEFAULT_MAX_START_RETRIES = 3
const DEFAULT_RETRY_BACKOFF_MS = [120_000, 300_000, 900_000]
const AUTOPILOT_RETRY_BACKOFF_ENV = 'ARCHE_AUTOPILOT_RETRY_BACKOFF_MS'

type AutopilotRetryTrigger = 'on_create' | 'schedule' | 'manual'

let warnedInvalidRetryBackoffValue: string | null = null

export type AutopilotRetryPlan =
  | {
      ok: true
      maxAttempts: number
      maxRetries: number
      nextRetryAttempt: number
      retryAt: Date
    }
  | {
      ok: false
      maxAttempts: number
      maxRetries: number
      reason: 'trigger_not_retryable' | 'post_prompt_failure' | 'non_retryable_error' | 'retry_exhausted'
    }

function parsePositiveInteger(value: string | undefined, fallback: number): number {
  const parsed = value ? Number(value) : Number.NaN
  return Number.isInteger(parsed) && parsed >= 0 ? parsed : fallback
}

export function getAutopilotMaxStartRetries(): number {
  return parsePositiveInteger(process.env.ARCHE_AUTOPILOT_MAX_START_RETRIES, DEFAULT_MAX_START_RETRIES)
}

export function getAutopilotRetryBackoffMs(): number[] {
  const raw = process.env[AUTOPILOT_RETRY_BACKOFF_ENV]
  if (!raw) {
    return DEFAULT_RETRY_BACKOFF_MS
  }

  const invalidValues: string[] = []
  const values = raw.split(',').flatMap((value) => {
    const trimmed = value.trim()
    const parsed = Number(trimmed)
    if (Number.isFinite(parsed) && parsed > 0) {
      return [parsed]
    }

    invalidValues.push(trimmed)
    return []
  })

  if (invalidValues.length > 0 && warnedInvalidRetryBackoffValue !== raw) {
    warnedInvalidRetryBackoffValue = raw
    console.warn('[autopilot] Invalid retry backoff configuration entries ignored', {
      env: AUTOPILOT_RETRY_BACKOFF_ENV,
      invalidValues,
      value: raw,
    })
  }

  return values.length > 0 ? values : DEFAULT_RETRY_BACKOFF_MS
}

export function isRetryableAutopilotStartError(error: string): boolean {
  const normalized = error.toLowerCase()
  return (
    normalized.includes('healthcheck timeout') ||
    normalized.includes('instance_start_timeout') ||
    normalized.includes('instance_unavailable') ||
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

export function planAutopilotRetry(params: {
  error: string
  now: Date
  promptSent: boolean
  retryAttempt: number
  trigger: AutopilotRetryTrigger
}): AutopilotRetryPlan {
  const maxRetries = getAutopilotMaxStartRetries()
  const maxAttempts = maxRetries + 1

  if (params.trigger !== 'schedule') {
    return { ok: false, maxAttempts, maxRetries, reason: 'trigger_not_retryable' }
  }

  if (params.promptSent) {
    return { ok: false, maxAttempts, maxRetries, reason: 'post_prompt_failure' }
  }

  if (!isRetryableAutopilotStartError(params.error)) {
    return { ok: false, maxAttempts, maxRetries, reason: 'non_retryable_error' }
  }

  if (params.retryAttempt >= maxRetries) {
    return { ok: false, maxAttempts, maxRetries, reason: 'retry_exhausted' }
  }

  const backoffs = getAutopilotRetryBackoffMs()
  const backoffMs = backoffs[params.retryAttempt] ?? backoffs[backoffs.length - 1] ?? DEFAULT_RETRY_BACKOFF_MS[0]

  return {
    ok: true,
    maxAttempts,
    maxRetries,
    nextRetryAttempt: params.retryAttempt + 1,
    retryAt: new Date(params.now.getTime() + backoffMs),
  }
}

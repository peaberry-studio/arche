export const HARNESS_ERROR_CODES = [
  'session_not_found',
  'session_busy',
  'session_archived',
  'runtime_unsupported',
  'execution_termination_unconfirmed',
  'caller_identity_unavailable',
  'instance_unavailable',
  'runtime_error',
  'healthcheck_timeout',
  'unhealthy_response',
  'sync_failed',
  'event_stream_unavailable',
  'provider_auth_missing',
  'dns_resolution_error',
  'connection_refused',
  'connect_timeout',
  'fetch_failed',
  'invalid_json',
] as const

export type HarnessErrorCode = typeof HARNESS_ERROR_CODES[number] | `http_status_${number}`

export type HarnessError = {
  code: HarnessErrorCode
  detail?: string
  status?: number
}

export type HarnessResult<T> =
  | { ok: true; data: T }
  | { ok: false; error: HarnessError }

export const EXECUTION_TERMINATION_UNCONFIRMED_ERROR = 'execution_termination_unconfirmed'

export function harnessFailure(code: HarnessErrorCode, detail?: string, status?: number): { ok: false; error: HarnessError } {
  return { ok: false, error: { code, ...(detail ? { detail } : {}), ...(status !== undefined ? { status } : {}) } }
}

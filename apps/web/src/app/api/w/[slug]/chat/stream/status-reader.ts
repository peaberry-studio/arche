import { getTerminalRetryError } from '@/lib/opencode/retry-state'

type UpstreamSessionStatusEntry = {
  action?: {
    reason?: string
  }
  type?: string
}

type UpstreamSessionStatusResponse = Record<string, UpstreamSessionStatusEntry | undefined>

type UpstreamSessionStatusReaderOptions = {
  baseUrl: string
  authHeader: string
  sessionId: string
  getSessionIds?: () => Iterable<string>
  onRead?: (result: UpstreamSessionStatusReadResult) => void
}

function readAggregatedSessionStatus(
  data: UpstreamSessionStatusResponse,
  sessionId: string,
  sessionIds: Iterable<string>,
): { status: string | null; terminalError?: string } {
  const ids = new Set<string>([sessionId, ...sessionIds])
  let sawBusy = false
  let sawRetry = false
  let sawIdle = false
  let terminalError: string | undefined

  for (const id of ids) {
    const sessionStatus = data[id]
    const status = typeof sessionStatus?.type === 'string' ? sessionStatus.type : null
    const nextTerminalError = getTerminalRetryError(sessionStatus)
    if (nextTerminalError && !terminalError) {
      terminalError = nextTerminalError
    }
    if (status === 'busy') sawBusy = true
    else if (status === 'retry') sawRetry = true
    else if (status === 'idle') sawIdle = true
  }

  if (sawBusy) return { status: 'busy', ...(terminalError ? { terminalError } : {}) }
  if (sawRetry) return { status: 'retry', ...(terminalError ? { terminalError } : {}) }
  if (sawIdle) return { status: 'idle', ...(terminalError ? { terminalError } : {}) }
  return { status: null, ...(terminalError ? { terminalError } : {}) }
}

export type UpstreamSessionStatusReadResult = {
  durationMs: number
  outcome: 'error' | 'http_error' | 'success'
  responseStatus?: number
  status: string | null
  terminalError?: string
}

const UPSTREAM_STATUS_CACHE_WINDOW_MS = 2_000
const UPSTREAM_STATUS_TIMEOUT_MS = 3_000

export function createUpstreamSessionStatusReader({
  baseUrl,
  authHeader,
  sessionId,
  getSessionIds,
  onRead,
}: UpstreamSessionStatusReaderOptions): () => Promise<string | null> {
  let cache: { expiresAt: number; sessionKey: string; status: string | null } | null = null

  const getSessionKey = () =>
    [sessionId, ...new Set(getSessionIds?.() ?? [sessionId])].sort().join(',')

  return async () => {
    const now = Date.now()
    const sessionKey = getSessionKey()
    if (cache && now < cache.expiresAt && cache.sessionKey === sessionKey) {
      return cache.status
    }

    const startedAt = Date.now()
    try {
      const response = await fetch(`${baseUrl}/session/status`, {
        method: 'GET',
        headers: {
          Authorization: authHeader,
          Accept: 'application/json',
        },
        cache: 'no-store',
        signal: AbortSignal.timeout(UPSTREAM_STATUS_TIMEOUT_MS),
      })

      if (!response.ok) {
        console.warn('[chat-stream] Upstream session status request failed', {
          baseUrl,
          sessionId,
          status: response.status,
        })
        cache = { expiresAt: now + UPSTREAM_STATUS_CACHE_WINDOW_MS, sessionKey, status: null }
        onRead?.({
          durationMs: Date.now() - startedAt,
          outcome: 'http_error',
          responseStatus: response.status,
          status: null,
        })
        return null
      }

      const data = await response.json().catch(() => null) as UpstreamSessionStatusResponse | null
      const { status, terminalError } = data
        ? readAggregatedSessionStatus(data, sessionId, getSessionIds?.() ?? [sessionId])
        : { status: null }
      cache = { expiresAt: now + UPSTREAM_STATUS_CACHE_WINDOW_MS, sessionKey, status }
      onRead?.({
        durationMs: Date.now() - startedAt,
        outcome: 'success',
        status,
        ...(terminalError ? { terminalError } : {}),
      })
      return status
    } catch (error) {
      console.warn('[chat-stream] Failed to read upstream session status', {
        baseUrl,
        sessionId,
        error: error instanceof Error ? error.message : String(error),
      })
      cache = { expiresAt: now + UPSTREAM_STATUS_CACHE_WINDOW_MS, sessionKey, status: null }
      onRead?.({ durationMs: Date.now() - startedAt, outcome: 'error', status: null })
      return null
    }
  }
}

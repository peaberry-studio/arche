type UpstreamSessionStatusEntry = {
  type?: string
}

type UpstreamSessionStatusResponse = Record<string, UpstreamSessionStatusEntry | undefined>

type UpstreamSessionStatusReaderOptions = {
  baseUrl: string
  authHeader: string
  sessionId: string
}

const UPSTREAM_STATUS_CACHE_WINDOW_MS = 2_000
const UPSTREAM_STATUS_TIMEOUT_MS = 3_000

export function createUpstreamSessionStatusReader({
  baseUrl,
  authHeader,
  sessionId,
}: UpstreamSessionStatusReaderOptions): () => Promise<string | null> {
  let cache: { expiresAt: number; status: string | null } | null = null

  return async () => {
    const now = Date.now()
    if (cache && now < cache.expiresAt) {
      return cache.status
    }

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
        cache = { expiresAt: now + UPSTREAM_STATUS_CACHE_WINDOW_MS, status: null }
        return null
      }

      const data = await response.json().catch(() => null) as UpstreamSessionStatusResponse | null
      const sessionStatus = data?.[sessionId]
      const status = typeof sessionStatus?.type === 'string' ? sessionStatus.type : null
      cache = { expiresAt: now + UPSTREAM_STATUS_CACHE_WINDOW_MS, status }
      return status
    } catch (error) {
      console.warn('[chat-stream] Failed to read upstream session status', {
        baseUrl,
        sessionId,
        error: error instanceof Error ? error.message : String(error),
      })
      cache = { expiresAt: now + UPSTREAM_STATUS_CACHE_WINDOW_MS, status: null }
      return null
    }
  }
}

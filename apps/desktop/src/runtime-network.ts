import { createServer } from 'net'

const MAX_FALLBACK_PORT_ATTEMPTS = 10

export async function findAvailablePort(
  preferredPort: number,
  host: string,
  excludedPorts: number[] = [],
): Promise<number> {
  const preferredResult = await tryListen(preferredPort, host)
  if (preferredResult.ok && !excludedPorts.includes(preferredResult.port)) {
    return preferredResult.port
  }

  if (!preferredResult.ok && preferredResult.errorCode !== 'EADDRINUSE') {
    throw preferredResult.error
  }

  const maxFallbackAttempts = Math.max(MAX_FALLBACK_PORT_ATTEMPTS, excludedPorts.length + 1)
  for (let attempt = 0; attempt < maxFallbackAttempts; attempt++) {
    const fallbackResult = await tryListen(0, host)
    if (!fallbackResult.ok) {
      throw fallbackResult.error
    }

    if (!excludedPorts.includes(fallbackResult.port)) {
      return fallbackResult.port
    }
  }

  throw new Error(
    `Failed to find an available port after ${String(maxFallbackAttempts)} fallback attempts.`,
  )
}

type ListenResult =
  | { ok: true; port: number }
  | { ok: false; error: Error; errorCode?: string }

async function tryListen(port: number, host: string): Promise<ListenResult> {
  return new Promise((resolve) => {
    const server = createServer()

    server.once('error', (error: NodeJS.ErrnoException) => {
      resolve({
        ok: false,
        error,
        errorCode: error.code,
      })
    })

    server.listen(port, host, () => {
      const address = server.address()
      if (!address || typeof address === 'string') {
        server.close(() => {
          resolve({ ok: false, error: new Error('Failed to resolve listening port') })
        })
        return
      }

      const resolvedPort = address.port
      server.close(() => {
        resolve({ ok: true, port: resolvedPort })
      })
    })
  })
}

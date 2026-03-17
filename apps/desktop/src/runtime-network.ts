import { createServer } from 'net'

export async function findAvailablePort(preferredPort: number, host: string): Promise<number> {
  const preferredResult = await tryListen(preferredPort, host)
  if (preferredResult.ok) {
    return preferredResult.port
  }

  if (preferredResult.errorCode !== 'EADDRINUSE') {
    throw preferredResult.error
  }

  const fallbackResult = await tryListen(0, host)
  if (!fallbackResult.ok) {
    throw fallbackResult.error
  }

  return fallbackResult.port
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

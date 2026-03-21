import { createServer } from 'net'

const LOOPBACK_HOST = '127.0.0.1'

type ListenResult =
  | { ok: true; port: number }
  | { ok: false; error: Error; errorCode?: string }

async function tryListen(port: number): Promise<ListenResult> {
  return new Promise((resolve) => {
    const server = createServer()

    server.once('error', (error: NodeJS.ErrnoException) => {
      resolve({ ok: false, error, errorCode: error.code })
    })

    server.listen(port, LOOPBACK_HOST, () => {
      const address = server.address()
      if (!address || typeof address === 'string') {
        server.close(() => {
          resolve({ ok: false, error: new Error('Failed to resolve listening port') })
        })
        return
      }

      server.close(() => {
        resolve({ ok: true, port: address.port })
      })
    })
  })
}

export async function findAvailablePort(preferredPort: number, excludedPorts: number[] = []): Promise<number> {
  const preferredResult = await tryListen(preferredPort)
  if (preferredResult.ok && !excludedPorts.includes(preferredResult.port)) {
    return preferredResult.port
  }

  if (!preferredResult.ok && preferredResult.errorCode !== 'EADDRINUSE') {
    throw preferredResult.error
  }

  const fallbackResult = await tryListen(0)
  if (!fallbackResult.ok) {
    throw fallbackResult.error
  }

  if (excludedPorts.includes(fallbackResult.port)) {
    return findAvailablePort(0, excludedPorts)
  }

  return fallbackResult.port
}

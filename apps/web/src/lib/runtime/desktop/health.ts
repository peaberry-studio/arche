import { checkRuntimeHealth } from '@/lib/harness/registry'

const LOOPBACK_HOST = '127.0.0.1'

export async function checkOpenCodeHealthy(port: number, password: string, slug = 'desktop'): Promise<boolean> {
  const result = await checkRuntimeHealth(slug, {
    baseUrl: `http://${LOOPBACK_HOST}:${port}`,
    password,
    timeoutMs: 3_000,
  })
  return result.ok
}

export async function waitForHttpReady(
  url: string,
  headers: Record<string, string>,
  timeoutMs: number,
  intervalMs: number,
): Promise<boolean> {
  const deadline = Date.now() + timeoutMs

  while (Date.now() < deadline) {
    try {
      const response = await fetch(url, {
        method: 'GET',
        headers,
        signal: AbortSignal.timeout(3_000),
      })

      if (response.ok || response.status === 401 || response.status === 404) {
        return true
      }
    } catch {
      // keep polling until timeout
    }

    await new Promise((resolve) => setTimeout(resolve, intervalMs))
  }

  return false
}

export async function waitForOpenCodeHealthy(
  port: number,
  password: string,
  timeoutMs: number,
  intervalMs: number,
  slug = 'desktop',
): Promise<boolean> {
  const deadline = Date.now() + timeoutMs

  while (Date.now() < deadline) {
    if (await checkOpenCodeHealthy(port, password, slug)) {
      return true
    }

    await new Promise((resolve) => setTimeout(resolve, intervalMs))
  }

  return false
}

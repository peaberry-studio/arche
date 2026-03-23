const LOOPBACK_HOST = '127.0.0.1'
const DEFAULT_USERNAME = 'opencode'

function makeAuthHeader(username: string, password: string): string {
  return `Basic ${Buffer.from(`${username}:${password}`).toString('base64')}`
}

export async function checkOpenCodeHealthy(port: number, password: string): Promise<boolean> {
  const authHeader = makeAuthHeader(DEFAULT_USERNAME, password)

  try {
    const response = await fetch(`http://${LOOPBACK_HOST}:${port}/global/health`, {
      headers: {
        Authorization: authHeader,
        Accept: 'application/json',
      },
      signal: AbortSignal.timeout(3_000),
    })

    if (!response.ok) {
      return false
    }

    const data = await response.json().catch(() => null)
    return data?.healthy === true
  } catch {
    return false
  }
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
): Promise<boolean> {
  const deadline = Date.now() + timeoutMs

  while (Date.now() < deadline) {
    if (await checkOpenCodeHealthy(port, password)) {
      return true
    }

    await new Promise((resolve) => setTimeout(resolve, intervalMs))
  }

  return false
}

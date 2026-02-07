export function firstHeaderValue(value: string | null): string | null {
  if (!value) return null
  const first = value.split(',')[0]?.trim()
  return first || null
}

export function stripPort(host: string): string {
  return host.replace(/:\d+$/, '')
}

export function getClientIp(headers: Headers): string | null {
  const xff = firstHeaderValue(headers.get('x-forwarded-for'))
  if (xff) return xff
  const realIp = firstHeaderValue(headers.get('x-real-ip'))
  return realIp
}

function isBindAddress(host: string): boolean {
  const withoutPort = stripPort(host).trim().toLowerCase()
  const normalized = withoutPort.replace(/^\[/, '').replace(/\]$/, '')
  return normalized === '0.0.0.0' || normalized === '::'
}

function normalizeBaseUrl(value: string): string | null {
  const trimmed = value.trim()
  if (!trimmed) return null

  try {
    const url = new URL(trimmed)
    if (!url.host || isBindAddress(url.host)) return null
    return `${url.protocol}//${url.host}`
  } catch {
    return null
  }
}

export function getPublicBaseUrl(headers: Headers, fallbackOrigin: string): string {
  const configured = normalizeBaseUrl(process.env.ARCHE_PUBLIC_BASE_URL ?? '')
  if (configured) return configured

  const proto = firstHeaderValue(headers.get('x-forwarded-proto')) || 'http'
  const forwardedHost = firstHeaderValue(headers.get('x-forwarded-host'))
  if (forwardedHost && !isBindAddress(forwardedHost)) {
    return `${proto}://${forwardedHost}`
  }

  const host = firstHeaderValue(headers.get('host'))
  if (host && !isBindAddress(host)) {
    return `${proto}://${host}`
  }

  const fallback = normalizeBaseUrl(fallbackOrigin)
  if (fallback) return fallback

  return fallbackOrigin
}

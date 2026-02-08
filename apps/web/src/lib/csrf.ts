export function validateSameOrigin(request: Request): { ok: true } | { ok: false } {
  const origin = request.headers.get('origin')
  if (!origin || origin === 'null') {
    return { ok: false }
  }

  const host = request.headers.get('host')
  if (!host) {
    return { ok: false }
  }

  let originUrl: URL
  try {
    originUrl = new URL(origin)
  } catch {
    return { ok: false }
  }

  if (originUrl.host !== host) {
    return { ok: false }
  }

  return { ok: true }
}

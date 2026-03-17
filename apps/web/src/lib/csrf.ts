import { getPublicBaseUrl } from '@/lib/http'
import { getRuntimeCapabilities } from '@/lib/runtime/capabilities'

export function validateSameOrigin(request: Request): { ok: true } | { ok: false } {
  const caps = getRuntimeCapabilities()
  if (!caps.csrf) {
    return { ok: true }
  }

  const origin = request.headers.get('origin')
  if (!origin || origin === 'null') {
    return { ok: false }
  }

  let originUrl: URL
  try {
    originUrl = new URL(origin)
  } catch {
    return { ok: false }
  }

  let requestUrl: URL
  try {
    requestUrl = new URL(request.url)
  } catch {
    return { ok: false }
  }

  const expectedBaseUrl = getPublicBaseUrl(request.headers, requestUrl.origin)

  let expectedOrigin: string
  try {
    expectedOrigin = new URL(expectedBaseUrl).origin
  } catch {
    return { ok: false }
  }

  if (originUrl.origin !== expectedOrigin) {
    return { ok: false }
  }

  return { ok: true }
}

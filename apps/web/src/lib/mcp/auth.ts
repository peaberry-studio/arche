import { hasPatPrefix, hashPatLookup, verifyPat } from '@/lib/mcp/pat'
import { getRuntimeCapabilities } from '@/lib/runtime/capabilities'
import type { RuntimeUser } from '@/lib/runtime/types'
import { patService } from '@/lib/services'

export type McpAuthResult =
  | { ok: true; user: RuntimeUser; tokenId: string }
  | { ok: false; status: 401 }

export async function authenticatePat(request: Request): Promise<McpAuthResult> {
  const capabilities = getRuntimeCapabilities()
  if (!capabilities.mcp) {
    return { ok: false, status: 401 }
  }

  const token = extractBearerToken(request.headers)
  if (!token || !hasPatPrefix(token)) {
    return { ok: false, status: 401 }
  }

  const record = await patService.findByLookupHash(hashPatLookup(token))
  if (!record) {
    return { ok: false, status: 401 }
  }

  if (!verifyPat(token, record.salt, record.tokenHash)) {
    return { ok: false, status: 401 }
  }

  if (record.revokedAt || record.expiresAt.getTime() <= Date.now()) {
    return { ok: false, status: 401 }
  }

  void patService.touchLastUsed(record.id).catch(() => {})

  return {
    ok: true,
    user: record.user,
    tokenId: record.id,
  }
}

function extractBearerToken(headers: Headers): string | null {
  const authorization = headers.get('authorization')
  if (!authorization) {
    return null
  }

  const match = authorization.match(/^Bearer\s+(.+)$/i)
  return match?.[1]?.trim() || null
}

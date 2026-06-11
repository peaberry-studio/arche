import crypto from 'crypto'

import { NextRequest } from 'next/server'

import { resolveInstanceConnection } from '@/lib/opencode/connection-resolver'
import { userService } from '@/lib/services'

function timingSafeMatch(expected: string, actual: string): boolean {
  const expectedBuffer = Buffer.from(expected)
  const actualBuffer = Buffer.from(actual)
  if (expectedBuffer.length !== actualBuffer.length) return false
  return crypto.timingSafeEqual(expectedBuffer, actualBuffer)
}

export async function getInternalLearningContext(request: NextRequest): Promise<
  | { ok: true; userId: string; slug: string }
  | { ok: false; error: string; status: number }
> {
  const slug = request.headers.get('x-arche-workspace-slug')?.trim()
  const authorization = request.headers.get('authorization')
  if (!slug || !authorization) {
    return { ok: false, error: 'unauthorized', status: 401 }
  }

  const connection = await resolveInstanceConnection(slug)
  if (!connection || !timingSafeMatch(connection.authHeader, authorization)) {
    return { ok: false, error: 'unauthorized', status: 401 }
  }

  const user = await userService.findIdBySlug(slug)
  if (!user) {
    return { ok: false, error: 'not_found', status: 404 }
  }

  return { ok: true, userId: user.id, slug }
}

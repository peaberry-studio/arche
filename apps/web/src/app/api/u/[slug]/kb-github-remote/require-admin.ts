import { NextResponse } from 'next/server'

import { requireCapability } from '@/lib/runtime/require-capability'

export function requireAdmin(user: { id: string; role: string }) {
  const denied = requireCapability('kbGithubSync')
  if (denied) {
    return { ok: false as const, response: denied }
  }

  if (user.role !== 'ADMIN') {
    return {
      ok: false as const,
      response: NextResponse.json({ error: 'forbidden' }, { status: 403 }),
    }
  }

  return { ok: true as const }
}

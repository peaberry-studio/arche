import { NextResponse } from 'next/server'

import { withAuth } from '@/lib/runtime/with-auth'
import { instanceService } from '@/lib/services'
import { getRuntimeConfigHashForSlug } from '@/lib/spawner/runtime-config-hash'

type ConfigStatusResponse = {
  pending: boolean
}

export const GET = withAuth<ConfigStatusResponse | { error: string }>(
  { csrf: false },
  async (_request, { slug }) => {
    const runtime = await getRuntimeConfigHashForSlug(slug)
    if (!runtime.ok) {
      const status = runtime.error === 'not_found' || runtime.error === 'user_not_found'
        ? 404
        : runtime.error === 'kb_unavailable'
          ? 503
          : 500
      return NextResponse.json({ error: runtime.error ?? 'read_failed' }, { status })
    }

    const instance = await instanceService.findAppliedConfigShaBySlug(slug)

    const pending = instance?.appliedConfigSha !== runtime.hash
    return NextResponse.json({ pending })
  }
)

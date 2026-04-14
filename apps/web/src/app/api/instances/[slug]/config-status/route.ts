import { NextResponse } from 'next/server'

import { withAuth } from '@/lib/runtime/with-auth'
import { instanceService, providerService, userService } from '@/lib/services'
import { getRuntimeConfigHashForSlug } from '@/lib/spawner/runtime-config-hash'

type ConfigStatusResponse = {
  pending: boolean
  reason: 'config' | 'provider_sync' | null
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
    const user = await userService.findIdBySlug(slug)
    const providerPending = user
      ? await providerService.hasPendingRestartByUserId(user.id)
      : false

    const configPending = instance?.appliedConfigSha != null && instance.appliedConfigSha !== runtime.hash
    const reason = configPending ? 'config' : providerPending ? 'provider_sync' : null
    const pending = Boolean(reason)
    return NextResponse.json(
      { pending, reason },
      { headers: { 'Cache-Control': 'no-store' } }
    )
  }
)

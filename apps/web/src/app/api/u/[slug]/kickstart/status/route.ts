import { NextResponse } from 'next/server'

import { getKickstartStatus } from '@/kickstart/status'
import type { KickstartStatus } from '@/kickstart/types'
import { withAuth } from '@/lib/runtime/with-auth'

type KickstartStatusResponse = {
  status: KickstartStatus
}

export const GET = withAuth<KickstartStatusResponse | { error: string }>(
  { csrf: false },
  async () => {
    const status = await getKickstartStatus()
    return NextResponse.json({ status })
  }
)

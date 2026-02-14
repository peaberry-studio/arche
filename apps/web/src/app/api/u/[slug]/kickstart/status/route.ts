import { NextRequest, NextResponse } from 'next/server'

import { getAuthenticatedUser } from '@/lib/auth'
import { getKickstartStatus } from '@/kickstart/status'
import type { KickstartStatus } from '@/kickstart/types'

type KickstartStatusResponse = {
  status: KickstartStatus
}

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ slug: string }> }
): Promise<NextResponse<KickstartStatusResponse | { error: string }>> {
  const session = await getAuthenticatedUser()
  if (!session) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  }

  const { slug } = await params
  if (session.user.slug !== slug && session.user.role !== 'ADMIN') {
    return NextResponse.json({ error: 'forbidden' }, { status: 403 })
  }

  const status = await getKickstartStatus()
  return NextResponse.json({ status })
}

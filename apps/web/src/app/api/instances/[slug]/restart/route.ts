import { NextResponse } from 'next/server'

import { getKickstartStatus } from '@/kickstart/status'
import { prisma } from '@/lib/prisma'
import { withAuth } from '@/lib/runtime/with-auth'
import { startInstance, stopInstance } from '@/lib/spawner/core'

export const POST = withAuth<{ ok: boolean; status?: string } | { error: string }>(
  { csrf: true },
  async (_request, { user, slug }) => {
    const dbUser = await prisma.user.findUnique({
      where: { slug },
      select: { id: true },
    })

    if (!dbUser) {
      return NextResponse.json({ error: 'user_not_found' }, { status: 404 })
    }

    const kickstartStatus = await getKickstartStatus()
    if (kickstartStatus !== 'ready') {
      return NextResponse.json({ error: 'setup_required' }, { status: 409 })
    }

    const stopResult = await stopInstance(slug, user.id)
    if (!stopResult.ok && stopResult.error !== 'not_running') {
      return NextResponse.json({ error: stopResult.error }, { status: 500 })
    }

    const startResult = await startInstance(slug, user.id)
    if (!startResult.ok) {
      const status = startResult.error === 'already_running' ? 409 : 500
      return NextResponse.json({ error: startResult.error }, { status })
    }

    return NextResponse.json({ ok: true, status: startResult.status })
  }
)

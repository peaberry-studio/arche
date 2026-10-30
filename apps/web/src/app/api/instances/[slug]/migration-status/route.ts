import { NextResponse } from 'next/server'

import { getInstanceMigrationStatusAction } from '@/actions/spawner'
import { withAuth } from '@/lib/runtime/with-auth'

export const GET = withAuth<{ migratingHistory: boolean } | { error: string }>(
  { csrf: false },
  async (_request, { slug }) => {
    const migratingHistory = await getInstanceMigrationStatusAction(slug)
    if (migratingHistory === null) {
      return NextResponse.json({ error: 'status_check_failed' }, { status: 503 })
    }
    return NextResponse.json(
      { migratingHistory },
      { headers: { 'Cache-Control': 'no-store' } },
    )
  },
)

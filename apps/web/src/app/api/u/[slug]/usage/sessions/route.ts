import { NextRequest, NextResponse } from 'next/server'

import { parseUsageFilters } from '@/app/api/u/[slug]/usage/filters'
import { withAuth } from '@/lib/runtime/with-auth'
import { providerUsageService } from '@/lib/services'

export const GET = withAuth(
  { csrf: false },
  async (request: NextRequest, { user }) => {
    if (user.role !== 'ADMIN') {
      return NextResponse.json({ error: 'forbidden' }, { status: 403 })
    }

    const sessions = await providerUsageService.listProviderUsageSessions(parseUsageFilters(request))
    return NextResponse.json({ sessions })
  },
)

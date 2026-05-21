import { NextRequest, NextResponse } from 'next/server'

import { parseUsageAuditFilters } from '@/app/api/u/[slug]/usage/filters'
import { withAuth } from '@/lib/runtime/with-auth'
import { usageDashboardService } from '@/lib/services'

export const GET = withAuth(
  { csrf: false },
  async (request: NextRequest, { user }) => {
    if (user.role !== 'ADMIN') {
      return NextResponse.json({ error: 'forbidden' }, { status: 403 })
    }

    const auditEvents = await usageDashboardService.listUsageAuditEvents(parseUsageAuditFilters(request))
    return NextResponse.json({ auditEvents })
  },
)

import { NextResponse } from 'next/server'

import { getKickstartAgentSummaries } from '@/kickstart/agents/catalog'
import { getKickstartTemplateSummaries } from '@/kickstart/templates'
import type { KickstartTemplatesResponse } from '@/kickstart/types'
import { withAuth } from '@/lib/runtime/with-auth'

export const GET = withAuth<KickstartTemplatesResponse | { error: string }>(
  { csrf: false },
  async () => {
    return NextResponse.json({
      templates: getKickstartTemplateSummaries(),
      agents: getKickstartAgentSummaries(),
    })
  }
)

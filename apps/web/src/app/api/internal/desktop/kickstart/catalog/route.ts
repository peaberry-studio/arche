import { NextRequest, NextResponse } from 'next/server'

import { getKickstartAgentSummaries } from '@/kickstart/agents/catalog'
import { getKickstartTemplateSummaries } from '@/kickstart/templates'
import { fetchModelsCatalog } from '@/lib/models-catalog'
import { DESKTOP_TOKEN_HEADER, validateDesktopToken } from '@/lib/runtime/desktop/token'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function GET(request: NextRequest) {
  const token = request.headers.get(DESKTOP_TOKEN_HEADER)
  if (!validateDesktopToken(token)) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  }

  const modelsResult = await fetchModelsCatalog()

  return NextResponse.json({
    agents: getKickstartAgentSummaries(),
    models: modelsResult.ok ? modelsResult.models : [],
    templates: getKickstartTemplateSummaries(),
  })
}

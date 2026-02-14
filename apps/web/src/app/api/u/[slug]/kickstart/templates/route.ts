import { NextRequest, NextResponse } from 'next/server'

import { getAuthenticatedUser } from '@/lib/auth'
import { getKickstartAgentSummaries } from '@/kickstart/agents/catalog'
import { getKickstartTemplateSummaries } from '@/kickstart/templates'
import type { KickstartTemplatesResponse } from '@/kickstart/types'

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ slug: string }> }
): Promise<NextResponse<KickstartTemplatesResponse | { error: string }>> {
  const session = await getAuthenticatedUser()
  if (!session) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  }

  const { slug } = await params
  if (session.user.slug !== slug && session.user.role !== 'ADMIN') {
    return NextResponse.json({ error: 'forbidden' }, { status: 403 })
  }

  return NextResponse.json({
    templates: getKickstartTemplateSummaries(),
    agents: getKickstartAgentSummaries(),
  })
}

import { NextRequest, NextResponse } from 'next/server'

import { DESKTOP_TOKEN_HEADER, validateDesktopToken } from '@/lib/runtime/desktop/token'

const HEADERS = { 'Cache-Control': 'no-store' }

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function GET(request: NextRequest) {
  const token = request.headers.get(DESKTOP_TOKEN_HEADER)
  if (!validateDesktopToken(token)) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401, headers: HEADERS })
  }

  const version =
    process.env.ARCHE_RELEASE_VERSION?.trim() || process.env.ARCHE_GIT_SHA?.trim() || 'dev'

  return NextResponse.json(
    {
      app: 'arche',
      runtime: 'desktop',
      status: 'ok',
      version,
    },
    { headers: HEADERS },
  )
}

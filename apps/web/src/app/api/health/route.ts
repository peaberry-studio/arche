import { NextRequest, NextResponse } from 'next/server'

import { healthService } from '@/lib/services'

const HEADERS = { 'Cache-Control': 'no-store' }

export async function GET(request: NextRequest) {
  const deep = request.nextUrl.searchParams.get('deep') === 'true'
  const dbOk = await healthService.pingDatabase()

  if (!dbOk) {
    return NextResponse.json(
      { status: 'error', checks: { database: false } },
      { status: 503, headers: HEADERS },
    )
  }

  if (!deep) {
    return NextResponse.json(
      {
        status: 'ok',
        version: process.env.ARCHE_GIT_SHA ?? 'dev',
      },
      { headers: HEADERS },
    )
  }

  const containerProxyOk = await healthService.checkContainerProxy()

  const allOk = dbOk && containerProxyOk
  return NextResponse.json(
    {
      status: allOk ? 'ok' : 'degraded',
      version: process.env.ARCHE_GIT_SHA ?? 'dev',
      checks: {
        database: dbOk,
        containerProxy: containerProxyOk,
      },
    },
    { status: allOk ? 200 : 503, headers: HEADERS },
  )
}

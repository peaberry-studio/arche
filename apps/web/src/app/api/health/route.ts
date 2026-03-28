import { NextRequest, NextResponse } from 'next/server'

import { healthService } from '@/lib/services'

const HEADERS = { 'Cache-Control': 'no-store' }

export async function GET(request: NextRequest) {
  const deep = request.nextUrl.searchParams.get('deep') === 'true'
  const version = process.env.ARCHE_GIT_SHA ?? 'dev'
  const dbOk = await healthService.pingDatabase()

  if (!dbOk) {
    return NextResponse.json(
      { status: 'error', version, checks: { database: false } },
      { status: 503, headers: HEADERS },
    )
  }

  if (!deep) {
    return NextResponse.json(
      { status: 'ok', version, checks: { database: true } },
      { headers: HEADERS },
    )
  }

  const containerProxyOk = await healthService.checkContainerProxy()

  return NextResponse.json(
    {
      status: containerProxyOk ? 'ok' : 'degraded',
      version,
      checks: {
        database: true,
        containerProxy: containerProxyOk,
      },
    },
    { status: containerProxyOk ? 200 : 503, headers: HEADERS },
  )
}

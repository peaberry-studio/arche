import { createHash, timingSafeEqual } from 'node:crypto'
import { NextRequest, NextResponse } from 'next/server'

import { getClientIp, shouldTrustProxyHeaders } from '@/lib/http'
import { checkRateLimit } from '@/lib/rate-limit'

import { healthService } from '@/lib/services'

const HEADERS = { 'Cache-Control': 'no-store' }

export async function GET(request: NextRequest) {
  const deep = request.nextUrl.searchParams.get('deep') === 'true'
  if (shouldTrustProxyHeaders(request.headers) && !checkRateLimit(`health:${getClientIp(request.headers) ?? 'ingress'}`, 120, 60_000).allowed) {
    return NextResponse.json({ error: 'rate_limited' }, { status: 429, headers: HEADERS })
  }
  if (deep) {
    const expected = process.env.ARCHE_INTERNAL_TOKEN
    const supplied = request.headers.get('authorization') ?? ''
    if (!expected || !timingSafeEqual(
      createHash('sha256').update(`Bearer ${expected}`).digest(),
      createHash('sha256').update(supplied).digest(),
    )) return NextResponse.json({ error: 'unauthorized' }, { status: 401, headers: HEADERS })
  }
  const dbOk = await healthService.pingDatabase()

  if (!dbOk) {
    return NextResponse.json(
      { status: 'error', checks: { database: false } },
      { status: 503, headers: HEADERS },
    )
  }

  if (!deep) {
    return NextResponse.json(
      { status: 'ok', checks: { database: true } },
      { headers: HEADERS },
    )
  }

  const containerProxyOk = await healthService.checkContainerProxy()

  return NextResponse.json(
    {
      status: containerProxyOk ? 'ok' : 'degraded',
      checks: {
        database: true,
        containerProxy: containerProxyOk,
      },
    },
    { status: containerProxyOk ? 200 : 503, headers: HEADERS },
  )
}

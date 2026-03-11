import { NextResponse } from 'next/server'

import { healthService } from '@/lib/services'

const HEADERS = { 'Cache-Control': 'no-store' }

export async function GET() {
  const ok = await healthService.pingDatabase()

  if (ok) {
    return NextResponse.json(
      {
        status: 'ok',
        version: process.env.ARCHE_GIT_SHA ?? 'dev',
      },
      { headers: HEADERS },
    )
  }

  return NextResponse.json(
    { status: 'error' },
    { status: 503, headers: HEADERS },
  )
}

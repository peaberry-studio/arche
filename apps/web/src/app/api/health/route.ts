import { NextResponse } from 'next/server'

import { prisma } from '@/lib/prisma'

const HEADERS = { 'Cache-Control': 'no-store' }

export async function GET() {
  try {
    await prisma.$queryRaw`SELECT 1`

    return NextResponse.json(
      {
        status: 'ok',
        version: process.env.ARCHE_GIT_SHA ?? 'dev',
      },
      { headers: HEADERS },
    )
  } catch {
    return NextResponse.json(
      { status: 'error' },
      { status: 503, headers: HEADERS },
    )
  }
}

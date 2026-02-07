import { NextRequest, NextResponse } from 'next/server'

import { getAuthenticatedUser } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { getRuntimeConfigHashForSlug } from '@/lib/spawner/runtime-config-hash'

type ConfigStatusResponse = {
  pending: boolean
}

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ slug: string }> }
): Promise<NextResponse<ConfigStatusResponse | { error: string }>> {
  const session = await getAuthenticatedUser()
  if (!session) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  }

  const { slug } = await params

  if (session.user.slug !== slug && session.user.role !== 'ADMIN') {
    return NextResponse.json({ error: 'forbidden' }, { status: 403 })
  }

  const runtime = await getRuntimeConfigHashForSlug(slug)
  if (!runtime.ok) {
    const status = runtime.error === 'not_found' || runtime.error === 'user_not_found'
      ? 404
      : runtime.error === 'kb_unavailable'
        ? 503
        : 500
    return NextResponse.json({ error: runtime.error ?? 'read_failed' }, { status })
  }

  const instance = await prisma.instance.findUnique({
    where: { slug },
    select: { appliedConfigSha: true }
  })

  const pending = instance?.appliedConfigSha !== runtime.hash
  return NextResponse.json({ pending })
}

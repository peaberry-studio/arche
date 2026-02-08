import { NextRequest, NextResponse } from 'next/server'

import { getAuthenticatedUser } from '@/lib/auth'
import { validateSameOrigin } from '@/lib/csrf'
import { startInstance, stopInstance } from '@/lib/spawner/core'

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ slug: string }> }
): Promise<NextResponse<{ ok: boolean; status?: string } | { error: string }>> {
  const session = await getAuthenticatedUser()
  if (!session) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  }

  const originValidation = validateSameOrigin(request)
  if (!originValidation.ok) {
    return NextResponse.json({ error: 'forbidden' }, { status: 403 })
  }

  const { slug } = await params

  if (session.user.slug !== slug && session.user.role !== 'ADMIN') {
    return NextResponse.json({ error: 'forbidden' }, { status: 403 })
  }

  const stopResult = await stopInstance(slug, session.user.id)
  if (!stopResult.ok && stopResult.error !== 'not_running') {
    return NextResponse.json({ error: stopResult.error }, { status: 500 })
  }

  const startResult = await startInstance(slug, session.user.id)
  if (!startResult.ok) {
    const status = startResult.error === 'already_running' ? 409 : 500
    return NextResponse.json({ error: startResult.error }, { status })
  }

  return NextResponse.json({ ok: true, status: startResult.status })
}

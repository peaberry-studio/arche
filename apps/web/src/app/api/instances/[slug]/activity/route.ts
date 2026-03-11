import { NextRequest, NextResponse } from 'next/server'

import { validateSameOrigin } from '@/lib/csrf'
import { getSession } from '@/lib/runtime/session'
import { instanceService } from '@/lib/services'

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ slug: string }> }
) {
  const { slug } = await params

  const internalToken = process.env.ARCHE_INTERNAL_TOKEN
  const auth = request.headers.get('authorization')
  const internalAuthOk = Boolean(internalToken) && auth === `Bearer ${internalToken}`

  if (!internalAuthOk) {
    const originValidation = validateSameOrigin(request)
    if (!originValidation.ok) {
      return NextResponse.json({ error: 'forbidden' }, { status: 403 })
    }

    const session = await getSession()
    if (!session) {
      return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
    }

    if (session.user.slug !== slug && session.user.role !== 'ADMIN') {
      return NextResponse.json({ error: 'forbidden' }, { status: 403 })
    }
  }

  const instance = await instanceService.findBySlug(slug)
  if (!instance) {
    return NextResponse.json({ error: 'not_found' }, { status: 404 })
  }

  // Debounce: only update if last activity was more than 30 seconds ago
  const debounceMs = 30_000
  if (instance.lastActivityAt && Date.now() - instance.lastActivityAt.getTime() < debounceMs) {
    return NextResponse.json({ ok: true, debounced: true })
  }

  await instanceService.touchActivity(slug)

  return NextResponse.json({ ok: true })
}

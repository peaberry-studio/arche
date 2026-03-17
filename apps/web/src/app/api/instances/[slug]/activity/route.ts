import { NextRequest, NextResponse } from 'next/server'

import { withAuth } from '@/lib/runtime/with-auth'
import { instanceService } from '@/lib/services'

async function touchInstanceActivity(slug: string): Promise<NextResponse<{ ok: true; debounced?: boolean } | { error: string }>> {
  const instance = await instanceService.findBySlug(slug)
  if (!instance) {
    return NextResponse.json({ error: 'not_found' }, { status: 404 })
  }

  const debounceMs = 30_000
  if (instance.lastActivityAt && Date.now() - instance.lastActivityAt.getTime() < debounceMs) {
    return NextResponse.json({ ok: true, debounced: true })
  }

  await instanceService.touchActivity(slug)

  return NextResponse.json({ ok: true })
}

const patchWithAuth = withAuth<{ ok: true; debounced?: boolean } | { error: string }>(
  { csrf: true },
  async (_request, { slug }) => touchInstanceActivity(slug)
)

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ slug: string }> }
) {
  const internalToken = process.env.ARCHE_INTERNAL_TOKEN
  const auth = request.headers.get('authorization')
  const internalAuthOk = Boolean(internalToken) && auth === `Bearer ${internalToken}`

  if (internalAuthOk) {
    const { slug } = await params
    return touchInstanceActivity(slug)
  }

  return patchWithAuth(request, { params })
}

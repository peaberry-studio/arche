import { NextRequest, NextResponse } from 'next/server'

import { getAuthenticatedUser } from '@/lib/auth'
import { fetchModelsCatalog } from '@/lib/models-catalog'

type ModelsCatalogResponse = {
  models: Array<{
    id: string
    label: string
  }>
}

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ slug: string }> }
): Promise<NextResponse<ModelsCatalogResponse | { error: string }>> {
  const session = await getAuthenticatedUser()
  if (!session) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  }

  const { slug } = await params
  if (session.user.slug !== slug && session.user.role !== 'ADMIN') {
    return NextResponse.json({ error: 'forbidden' }, { status: 403 })
  }

  const modelsResult = await fetchModelsCatalog()
  if (!modelsResult.ok) {
    return NextResponse.json({ error: modelsResult.error }, { status: 503 })
  }

  return NextResponse.json({ models: modelsResult.models })
}

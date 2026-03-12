import { NextResponse } from 'next/server'

import { fetchModelsCatalog } from '@/lib/models-catalog'
import { withAuth } from '@/lib/runtime/with-auth'

type ModelsCatalogResponse = {
  models: Array<{
    id: string
    label: string
  }>
}

export const GET = withAuth<ModelsCatalogResponse | { error: string }>(
  { csrf: false },
  async () => {
    const modelsResult = await fetchModelsCatalog()
    if (!modelsResult.ok) {
      return NextResponse.json({ error: modelsResult.error }, { status: 503 })
    }

    return NextResponse.json({ models: modelsResult.models })
  }
)

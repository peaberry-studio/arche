import { NextResponse } from 'next/server'

import { isModelsCatalogToken } from '@/lib/providers/models-catalog-token'
import { getGatewayModelsCatalog } from '@/lib/providers/zen-catalog'
import { getRuntimeInternalApiRoot } from '@/lib/runtime/internal-api'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function GET(
  _request: Request,
  context: { params: Promise<{ token: string }> },
): Promise<Response> {
  const { token } = await context.params
  if (!isModelsCatalogToken(token)) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })

  const result = await getGatewayModelsCatalog(`${getRuntimeInternalApiRoot()}/providers`)
  if (!result.ok) return NextResponse.json({ error: result.error }, { status: 502 })
  return new Response(result.data, { headers: { 'content-type': 'application/json', 'cache-control': 'no-store' } })
}

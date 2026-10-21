import { NextResponse } from 'next/server'

import { getGatewayModelsCatalog } from '@/lib/providers/zen-catalog'
import { getRuntimeInternalApiRoot } from '@/lib/runtime/internal-api'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

// Model catalog for OpenCode 2 workspaces (`OPENCODE_MODELS_URL`): the public
// models.dev catalog with Zen endpoints routed through the provider gateway.
export async function GET() {
  const result = await getGatewayModelsCatalog(`${getRuntimeInternalApiRoot()}/providers`)
  if (!result.ok) return NextResponse.json({ error: result.error }, { status: 502 })
  return new Response(result.data, { headers: { 'content-type': 'application/json' } })
}

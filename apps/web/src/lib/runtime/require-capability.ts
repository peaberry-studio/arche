import { NextResponse } from 'next/server'

import {
  getRuntimeCapabilities,
  type RuntimeCapabilities,
} from '@/lib/runtime/capabilities'

export function requireCapability(
  capability: keyof RuntimeCapabilities
): NextResponse<{ error: string }> | null {
  const caps = getRuntimeCapabilities()
  if (caps[capability]) {
    return null
  }

  return NextResponse.json(
    { error: `${capability} is not available in this runtime mode` },
    { status: 403 },
  )
}

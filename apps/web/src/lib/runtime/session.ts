import { getRuntimeCapabilities } from '@/lib/runtime/capabilities'
import type { RuntimeSessionResult } from '@/lib/runtime/types'

export async function getSession(): Promise<RuntimeSessionResult> {
  const caps = getRuntimeCapabilities()
  if (!caps.auth) {
    const { getDesktopSession } = await import('@/lib/runtime/session-desktop')
    return getDesktopSession()
  }

  const { getWebSession } = await import('@/lib/runtime/session-web')
  return getWebSession()
}

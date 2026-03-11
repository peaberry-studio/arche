import { getRuntimeCapabilities } from '@/lib/runtime/capabilities'
import { getDesktopSession } from '@/lib/runtime/session-desktop'
import { getWebSession } from '@/lib/runtime/session-web'
import type { RuntimeSessionResult } from '@/lib/runtime/types'

export async function getSession(): Promise<RuntimeSessionResult> {
  const caps = getRuntimeCapabilities()
  if (!caps.auth) {
    return getDesktopSession()
  }
  return getWebSession()
}

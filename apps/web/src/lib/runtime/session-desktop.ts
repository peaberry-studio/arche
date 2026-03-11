import type { RuntimeSessionResult } from '@/lib/runtime/types'

const DESKTOP_SESSION: RuntimeSessionResult = {
  user: {
    id: 'local',
    email: 'local@arche.local',
    slug: 'local',
    role: 'ADMIN',
  },
  sessionId: 'local',
}

export async function getDesktopSession(): Promise<RuntimeSessionResult> {
  return DESKTOP_SESSION
}

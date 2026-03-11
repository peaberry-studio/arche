import { getAuthenticatedUser } from '@/lib/auth'
import type { RuntimeSessionResult } from '@/lib/runtime/types'

export async function getWebSession(): Promise<RuntimeSessionResult> {
  return getAuthenticatedUser()
}

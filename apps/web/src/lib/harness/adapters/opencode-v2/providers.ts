import type { HarnessProviderAccessInput } from '@/lib/harness/contract'
import { harnessFailure, type HarnessResult } from '@/lib/harness/errors'

export async function syncProviderAccess(
  _slug: string,
  _input: HarnessProviderAccessInput,
): Promise<HarnessResult<void>> {
  return harnessFailure(
    'sync_failed',
    'OpenCode V2 gateway-only endpoint enforcement, managed credential ownership and complete provider sync orchestration are unverified; no credentials changed, reload performed or freshness recorded',
  )
}

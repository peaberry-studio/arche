import crypto from 'node:crypto'

import { getCommonWorkspaceConfigHash } from '@/lib/common-workspace-config-store'
import { connectorService, userService } from '@/lib/services'

export type RuntimeConfigHashResult =
  | { ok: true; hash: string }
  | { ok: false; error: string }

export async function getRuntimeConfigHashForSlug(slug: string): Promise<RuntimeConfigHashResult> {
  const common = await getCommonWorkspaceConfigHash()
  if (!common.ok) {
    return { ok: false, error: common.error ?? 'read_failed' }
  }

  const user = await userService.findIdBySlug(slug)

  if (!user) {
    return { ok: false, error: 'user_not_found' }
  }

  let connectors: Array<{ id: string; type: string; enabled: boolean; updatedAt: Date }> = []
  try {
    connectors = await connectorService.findHashEntriesByUserId(user.id)
  } catch {
    connectors = []
  }

  const payload = JSON.stringify({
    commonConfigHash: common.hash,
    connectors: connectors.map((connector) => ({
      id: connector.id,
      type: connector.type,
      enabled: connector.enabled,
      updatedAt: connector.updatedAt.toISOString(),
    })),
  })

  const hash = crypto.createHash('sha256').update(payload).digest('hex')
  return { ok: true, hash }
}

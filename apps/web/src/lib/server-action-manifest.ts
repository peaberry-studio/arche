import { readFileSync } from 'node:fs'
import { join } from 'node:path'

import { isRecord } from '@/lib/records'

let actionIds: Set<string> | null | undefined

export function isKnownServerAction(actionId: string): boolean | null {
  if (actionIds === undefined) {
    const distDir = process.env.ARCHE_DESKTOP_NEXT_DIST_DIR || join(process.cwd(), '.next')
    try {
      const manifest: unknown = JSON.parse(readFileSync(join(distDir, 'server', 'server-reference-manifest.json'), 'utf8'))
      if (!isRecord(manifest) || !isRecord(manifest.node) || !isRecord(manifest.edge)) throw new Error('Invalid action manifest')
      actionIds = new Set([...Object.keys(manifest.node), ...Object.keys(manifest.edge)])
    } catch {
      console.warn('[server-actions] Build action manifest unavailable; using framework action handling')
      actionIds = null
    }
  }
  return actionIds?.has(actionId) ?? null
}

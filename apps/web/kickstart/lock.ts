import { promises as fs } from 'fs'
import path from 'path'

import { resolveKickstartConfigRepoRoot } from '@/kickstart/repositories'

const LOCK_FILE_NAME = '.kickstart-apply.lock'

async function getLockPath(): Promise<string | null> {
  const root = await resolveKickstartConfigRepoRoot()
  if (!root) return null
  return path.join(root, LOCK_FILE_NAME)
}

export async function isKickstartApplyLocked(): Promise<boolean> {
  const lockPath = await getLockPath()
  if (!lockPath) return false

  try {
    await fs.stat(lockPath)
    return true
  } catch {
    return false
  }
}

export async function acquireKickstartApplyLock(): Promise<
  | { ok: true; release: () => Promise<void> }
  | { ok: false; error: 'kb_unavailable' | 'conflict' | 'write_failed' }
> {
  const lockPath = await getLockPath()
  if (!lockPath) {
    return { ok: false, error: 'kb_unavailable' }
  }

  try {
    const handle = await fs.open(lockPath, 'wx')
    await handle.writeFile(`${process.pid}:${Date.now()}`)
    await handle.close()

    return {
      ok: true,
      release: async () => {
        await fs.rm(lockPath, { force: true }).catch(() => {})
      },
    }
  } catch (error) {
    if (error && typeof error === 'object' && 'code' in error) {
      const code = (error as { code?: string }).code
      if (code === 'EEXIST') {
        return { ok: false, error: 'conflict' }
      }
    }

    return { ok: false, error: 'write_failed' }
  }
}

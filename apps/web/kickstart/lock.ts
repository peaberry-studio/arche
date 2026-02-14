import { promises as fs } from 'fs'
import path from 'path'

import { resolveKickstartConfigRepoRoot } from '@/kickstart/repositories'

const LOCK_FILE_NAME = '.kickstart-apply.lock'
const LOCK_TTL_MS = 10 * 60 * 1000

type LockRecord = {
  pid: number | null
  timestamp: number | null
}

async function getLockPath(): Promise<string | null> {
  const root = await resolveKickstartConfigRepoRoot()
  if (!root) return null
  return path.join(root, LOCK_FILE_NAME)
}

function parseLockRecord(rawValue: string): LockRecord {
  const [pidRaw, timestampRaw] = rawValue.trim().split(':')
  const pid = pidRaw ? Number.parseInt(pidRaw, 10) : Number.NaN
  const timestamp = timestampRaw ? Number.parseInt(timestampRaw, 10) : Number.NaN

  return {
    pid: Number.isInteger(pid) && pid > 0 ? pid : null,
    timestamp: Number.isFinite(timestamp) && timestamp > 0 ? timestamp : null,
  }
}

function isProcessAlive(pid: number): boolean {
  try {
    process.kill(pid, 0)
    return true
  } catch (error) {
    if (error && typeof error === 'object' && 'code' in error) {
      const code = (error as { code?: string }).code
      if (code === 'EPERM') {
        return true
      }
      if (code === 'ESRCH') {
        return false
      }
    }

    return false
  }
}

function isLockStale(lockRecord: LockRecord): boolean {
  if (!lockRecord.timestamp) {
    return true
  }

  const ageMs = Date.now() - lockRecord.timestamp
  if (ageMs > LOCK_TTL_MS) {
    return true
  }

  if (lockRecord.pid && !isProcessAlive(lockRecord.pid)) {
    return true
  }

  return false
}

async function readLockRecord(
  lockPath: string
): Promise<{ exists: false } | { exists: true; stale: boolean }> {
  try {
    const rawRecord = await fs.readFile(lockPath, 'utf-8')
    const parsed = parseLockRecord(rawRecord)
    return {
      exists: true,
      stale: isLockStale(parsed),
    }
  } catch (error) {
    if (error && typeof error === 'object' && 'code' in error) {
      const code = (error as { code?: string }).code
      if (code === 'ENOENT') {
        return { exists: false }
      }
    }

    return {
      exists: true,
      stale: true,
    }
  }
}

async function releaseKickstartApplyLock(lockPath: string): Promise<void> {
  const lockState = await readLockRecord(lockPath)
  if (lockState.exists && lockState.stale) {
    console.warn('[kickstart] Releasing stale kickstart apply lock')
  }

  await fs.rm(lockPath, { force: true }).catch(() => {})
}

export async function isKickstartApplyLocked(): Promise<boolean> {
  const lockPath = await getLockPath()
  if (!lockPath) return false

  const lockState = await readLockRecord(lockPath)
  if (!lockState.exists) {
    return false
  }

  return !lockState.stale
}

export async function acquireKickstartApplyLock(): Promise<
  | { ok: true; release: () => Promise<void> }
  | { ok: false; error: 'kb_unavailable' | 'conflict' | 'write_failed' }
> {
  const lockPath = await getLockPath()
  if (!lockPath) {
    return { ok: false, error: 'kb_unavailable' }
  }

  const existingLock = await readLockRecord(lockPath)
  if (existingLock.exists && existingLock.stale) {
    await fs.rm(lockPath, { force: true }).catch(() => {})
  }

  try {
    const lockPayload = `${process.pid}:${Date.now()}`
    const handle = await fs.open(lockPath, 'wx')
    await handle.writeFile(lockPayload)
    await handle.close()

    return {
      ok: true,
      release: async () => {
        await releaseKickstartApplyLock(lockPath)
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

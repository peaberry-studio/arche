import { existsSync, mkdirSync, readFileSync, unlinkSync, writeFileSync } from 'fs'
import { join } from 'path'

import { getDesktopRuntimeDir } from './vault-layout'

const VAULT_LOCK_FILE_NAME = 'vault.lock'

type VaultLockFile = {
  pid: number
  acquiredAt: string
}

export type VaultLockHandle = {
  release: () => void
}

export type VaultLockCheck = {
  locked: boolean
  pid: number | null
}

function getVaultLockPath(vaultPath: string): string {
  return join(getDesktopRuntimeDir(vaultPath), VAULT_LOCK_FILE_NAME)
}

function isProcessAlive(pid: number): boolean {
  try {
    process.kill(pid, 0)
    return true
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code
    return code === 'EPERM'
  }
}

function readLockFile(lockPath: string): VaultLockFile | null {
  if (!existsSync(lockPath)) {
    return null
  }

  try {
    const parsed = JSON.parse(readFileSync(lockPath, 'utf-8')) as Partial<VaultLockFile>
    if (typeof parsed.pid !== 'number' || !Number.isInteger(parsed.pid) || parsed.pid <= 0) {
      return null
    }
    if (typeof parsed.acquiredAt !== 'string' || parsed.acquiredAt.trim().length === 0) {
      return null
    }
    return {
      pid: parsed.pid,
      acquiredAt: parsed.acquiredAt,
    }
  } catch {
    return null
  }
}

function removeLockFileIfStale(lockPath: string): VaultLockFile | null {
  const current = readLockFile(lockPath)
  if (!current) {
    if (existsSync(lockPath)) {
      unlinkSync(lockPath)
    }
    return null
  }

  if (isProcessAlive(current.pid)) {
    return current
  }

  unlinkSync(lockPath)
  return null
}

export function getVaultLockState(vaultPath: string): VaultLockCheck {
  const current = removeLockFileIfStale(getVaultLockPath(vaultPath))

  return {
    locked: Boolean(current),
    pid: current?.pid ?? null,
  }
}

export function acquireVaultLock(vaultPath: string): VaultLockHandle | null {
  const lockPath = getVaultLockPath(vaultPath)
  mkdirSync(getDesktopRuntimeDir(vaultPath), { recursive: true })

  const content = `${JSON.stringify({ pid: process.pid, acquiredAt: new Date().toISOString() }, null, 2)}\n`

  const current = removeLockFileIfStale(lockPath)
  if (current && current.pid !== process.pid) {
    return null
  }

  try {
    writeFileSync(lockPath, content, { encoding: 'utf-8', flag: 'wx' })
  } catch {
    const persisted = removeLockFileIfStale(lockPath)
    if (persisted && persisted.pid !== process.pid) {
      return null
    }

    writeFileSync(lockPath, content, { encoding: 'utf-8', flag: 'w' })
  }

  return {
    release: () => {
      const persisted = readLockFile(lockPath)
      if (persisted?.pid === process.pid && existsSync(lockPath)) {
        unlinkSync(lockPath)
      }
    },
  }
}

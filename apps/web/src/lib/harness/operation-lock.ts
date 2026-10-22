import { realpathSync } from 'node:fs'

import { Client } from 'pg'

import { harnessFailure, type HarnessResult } from '@/lib/harness/errors'
import { getDesktopVaultRuntimeContext } from '@/lib/runtime/desktop/context-store'
import { isDesktop } from '@/lib/runtime/mode'

// Lock connections live outside Prisma's pool; cap them per process so lock
// holders and waiters can never exhaust the database's connection budget.
export const MAX_LOCK_CONNECTIONS = 8
const LOCK_CONNECTION_WAIT_MS = 5_000
const LOCK_POLL_INTERVAL_MS = 250

type RuntimeOperationLockOptions = {
  // How long to wait for a holder of the same key; omitted refuses at once.
  waitMs?: number
}

const localHolders = new Map<string, Promise<void>>()
const connectionWaiters: (() => void)[] = []
let openConnections = 0

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

function localKey(key: string): string | null {
  if (!isDesktop()) return key
  const vaultRoot = getDesktopVaultRuntimeContext()?.vaultRoot ?? process.env.ARCHE_DATA_DIR
  return vaultRoot ? JSON.stringify([realpathSync(vaultRoot), key]) : null
}

// One holder per key in this process: the database is only asked for a key no
// local caller holds, so waiters never spend a connection on a local holder.
async function claimLocal(key: string, deadline: number): Promise<(() => void) | null> {
  for (let holder = localHolders.get(key); holder; holder = localHolders.get(key)) {
    const remaining = deadline - Date.now()
    if (remaining <= 0) return null
    await Promise.race([holder, sleep(remaining)])
  }
  let release!: () => void
  const held = new Promise<void>((resolve) => { release = resolve })
  localHolders.set(key, held)
  return () => {
    localHolders.delete(key)
    release()
  }
}

async function claimConnection(deadline: number): Promise<(() => void) | null> {
  while (openConnections >= MAX_LOCK_CONNECTIONS) {
    const remaining = deadline - Date.now()
    if (remaining <= 0) return null
    let wake!: () => void
    const freed = new Promise<void>((resolve) => { wake = resolve })
    connectionWaiters.push(wake)
    await Promise.race([freed, sleep(remaining)])
    const index = connectionWaiters.indexOf(wake)
    if (index >= 0) connectionWaiters.splice(index, 1)
  }
  openConnections++
  return () => {
    openConnections--
    connectionWaiters.shift()?.()
  }
}

export async function withRuntimeOperationLock<T>(
  key: string,
  work: (signal: AbortSignal) => Promise<HarnessResult<T>>,
  options: RuntimeOperationLockOptions = {},
): Promise<HarnessResult<T>> {
  const deadline = Date.now() + (options.waitMs ?? 0)
  const controller = new AbortController()
  let releaseLocal: (() => void) | null = null
  let releaseConnection: (() => void) | null = null
  let client: Client | undefined
  try {
    const scopedKey = localKey(key)
    if (!scopedKey) return harnessFailure('instance_unavailable')
    releaseLocal = await claimLocal(scopedKey, deadline)
    if (!releaseLocal) return harnessFailure('session_busy')
    if (!isDesktop()) {
      const connectionString = process.env.DATABASE_URL
      if (!connectionString) return harnessFailure('instance_unavailable')
      releaseConnection = await claimConnection(Math.max(deadline, Date.now() + LOCK_CONNECTION_WAIT_MS))
      if (!releaseConnection) return harnessFailure('session_busy', 'runtime_lock_capacity')
      client = new Client({ connectionString, connectionTimeoutMillis: 5_000, query_timeout: 5_000 })
      client.on('error', (error) => controller.abort(error))
      await client.connect()
      for (;;) {
        const { rows } = await client.query<{ locked: boolean }>('SELECT pg_try_advisory_lock(hashtextextended($1, 0)) AS locked', [key])
        if (rows[0]?.locked) break
        if (Date.now() >= deadline) return harnessFailure('session_busy')
        await sleep(Math.min(LOCK_POLL_INTERVAL_MS, deadline - Date.now()))
        controller.signal.throwIfAborted()
      }
    }
    controller.signal.throwIfAborted()
    const result = await work(controller.signal)
    controller.signal.throwIfAborted()
    return result
  } finally {
    controller.abort()
    try {
      await client?.end()
    } finally {
      releaseConnection?.()
      releaseLocal?.()
    }
  }
}

import { realpathSync } from 'node:fs'

import { Client } from 'pg'

import { harnessFailure, type HarnessResult } from '@/lib/harness/errors'
import { getDesktopVaultRuntimeContext } from '@/lib/runtime/desktop/context-store'
import { isDesktop } from '@/lib/runtime/mode'

const desktopOperations = new Set<string>()

export async function withRuntimeOperationLock<T>(key: string, work: (signal: AbortSignal) => Promise<HarnessResult<T>>): Promise<HarnessResult<T>> {
  const controller = new AbortController()
  let client: Client | undefined
  let desktopKey: string | undefined
  try {
    if (isDesktop()) {
      const vaultRoot = getDesktopVaultRuntimeContext()?.vaultRoot ?? process.env.ARCHE_DATA_DIR
      if (!vaultRoot) return harnessFailure('instance_unavailable')
      const candidate = JSON.stringify([realpathSync(vaultRoot), key])
      if (desktopOperations.has(candidate)) return harnessFailure('session_busy')
      desktopKey = candidate
      desktopOperations.add(desktopKey)
    } else {
      const connectionString = process.env.DATABASE_URL
      if (!connectionString) return harnessFailure('instance_unavailable')
      client = new Client({ connectionString, connectionTimeoutMillis: 5_000, query_timeout: 5_000 })
      client.on('error', (error) => controller.abort(error))
      await client.connect()
      const { rows } = await client.query<{ locked: boolean }>('SELECT pg_try_advisory_lock(hashtextextended($1, 0)) AS locked', [key])
      if (!rows[0]?.locked) return harnessFailure('session_busy')
    }
    controller.signal.throwIfAborted()
    const result = await work(controller.signal)
    controller.signal.throwIfAborted()
    return result
  } finally {
    controller.abort()
    if (desktopKey) desktopOperations.delete(desktopKey)
    await client?.end()
  }
}

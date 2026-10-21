import { realpathSync } from 'node:fs'

import type { HarnessOperationOptions } from '@/lib/harness/contract'
import { harnessFailure, type HarnessResult } from '@/lib/harness/errors'
import { prisma } from '@/lib/prisma'
import { getDesktopVaultRuntimeContext } from '@/lib/runtime/desktop/context-store'
import { isDesktop } from '@/lib/runtime/mode'

const desktopSubmissions = new Set<string>()

export async function withSessionSubmissionLock<T>(
  slug: string,
  sessionId: string,
  options: HarnessOperationOptions | undefined,
  submit: (options: HarnessOperationOptions) => Promise<HarnessResult<T>>,
): Promise<HarnessResult<T>> {
  const controller = new AbortController()
  const timeout = AbortSignal.timeout(60_000)
  const signal = AbortSignal.any([controller.signal, timeout, ...(options?.signal ? [options.signal] : [])])
  const run = () => {
    signal.throwIfAborted()
    return submit({ signal })
  }
  const key = JSON.stringify(['harness-prompt', slug, sessionId])
  if (isDesktop()) {
    const vaultRoot = getDesktopVaultRuntimeContext()?.vaultRoot ?? process.env.ARCHE_DATA_DIR
    if (!vaultRoot) return harnessFailure('instance_unavailable')
    const desktopKey = JSON.stringify([realpathSync(vaultRoot), key])
    if (desktopSubmissions.has(desktopKey)) return harnessFailure('session_busy')
    desktopSubmissions.add(desktopKey)
    try {
      return await run()
    } finally {
      controller.abort()
      desktopSubmissions.delete(desktopKey)
    }
  }
  try {
    return await prisma.$transaction(async (tx) => {
      const [lock] = await tx.$queryRaw<{ locked: boolean }[]>`
        SELECT pg_try_advisory_xact_lock(hashtextextended(${key}, 0)) AS locked
      `
      if (!lock?.locked) return harnessFailure('session_busy')
      return run()
    }, { maxWait: 5_000, timeout: 65_000 })
  } finally {
    controller.abort()
  }
}

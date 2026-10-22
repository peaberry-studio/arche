import type { HarnessSession, LegacySessionReader } from '@/lib/harness/contract'
import { harnessFailure, type HarnessResult } from '@/lib/harness/errors'
import { withRuntimeOperationLock } from '@/lib/harness/operation-lock'
import { getLegacySessionReader, getRuntimeConnection } from '@/lib/harness/registry'
import * as legacySessionArchive from '@/lib/services/legacy-session-archive'

export const PRE_ARCHIVE_INTERVAL_MS = 5 * 60 * 1000

let preArchiveRunning = false
let lastPreArchiveStartedAt = -Infinity
let lastPreArchiveSlug: string | undefined

async function readArchiveSource<T>(signal: AbortSignal, read: (signal: AbortSignal) => Promise<HarnessResult<T>>): Promise<HarnessResult<T>> {
  const requestSignal = AbortSignal.any([signal, AbortSignal.timeout(60_000)])
  const interrupted = Promise.withResolvers<never>()
  const onAbort = () => interrupted.reject(requestSignal.reason)
  requestSignal.addEventListener('abort', onAbort, { once: true })
  try {
    return await Promise.race([interrupted.promise, Promise.resolve().then(() => {
      requestSignal.throwIfAborted()
      return read(requestSignal)
    })])
  } finally {
    requestSignal.removeEventListener('abort', onAbort)
  }
}

export async function exportLegacySessions(slug: string, runtime: LegacySessionReader): Promise<HarnessResult<{ archived: number }>> {
  return exportSessions(slug, runtime, false)
}

async function readInventory(runtime: LegacySessionReader, signal: AbortSignal): Promise<HarnessResult<Map<string, HarnessSession>>> {
  const listed = await readArchiveSource(signal, () => runtime.listSessions({ rootsOnly: false, limit: Number.MAX_SAFE_INTEGER }))
  if (!listed.ok) return listed
  const pending = [...listed.data]
  const inventory = new Map<string, HarnessSession>()
  for (let index = 0; index < pending.length; index++) {
    const session = pending[index]
    if (inventory.has(session.id)) continue
    inventory.set(session.id, session)
    const children = await readArchiveSource(signal, () => runtime.listChildren(session.id))
    if (!children.ok) return children
    pending.push(...children.data)
  }
  return { ok: true, data: inventory }
}

function sameSession(left: HarnessSession, right: HarnessSession): boolean {
  return left.id === right.id && left.createdAtRaw === right.createdAtRaw &&
    left.updatedAtRaw === right.updatedAtRaw && left.title === right.title && left.parentId === right.parentId
}

async function exportSessions(slug: string, runtime: LegacySessionReader, skipUnstable: boolean): Promise<HarnessResult<{ archived: number }>> {
  if (runtime.slug !== slug) return harnessFailure('runtime_error', 'Legacy export workspace mismatch')

  try {
    return await withRuntimeOperationLock(JSON.stringify(['harness-archive', slug]), async (signal) => {
      const listed = await readArchiveSource(signal, () => runtime.listSessions({ rootsOnly: false, limit: Number.MAX_SAFE_INTEGER }))
      if (!listed.ok) return listed
      const pending = [...listed.data]
      const seen = new Map<string, HarnessSession>()
      let archived = 0

      for (let index = 0; index < pending.length; index++) {
        const session = pending[index]
        if (seen.has(session.id)) continue
        seen.set(session.id, session)

        const children = await readArchiveSource(signal, () => runtime.listChildren(session.id))
        if (!children.ok) return children
        pending.push(...children.data)

        const createdAt = new Date(session.createdAtRaw ?? NaN)
        const updatedAt = new Date(session.updatedAtRaw ?? NaN)
        if (!Number.isFinite(createdAt.getTime()) || !Number.isFinite(updatedAt.getTime())) {
          return harnessFailure('runtime_error', `Missing raw legacy session timestamps: ${session.id}`)
        }

        const statusBefore = await readArchiveSource(signal, (requestSignal) => runtime.sessionStatus({ signal: requestSignal }))
        if (!statusBefore.ok) return statusBefore
        if ((statusBefore.data[session.id]?.type ?? 'idle') !== 'idle') {
          if (skipUnstable) continue
          return harnessFailure('session_busy', `Legacy session is not idle: ${session.id}`)
        }

        const previous = await legacySessionArchive.findExportedSession(slug, session.id)
        if (previous?.validatedAt && previous.updatedAt.getTime() === updatedAt.getTime() &&
          previous.createdAt.getTime() === createdAt.getTime() &&
          previous.title === session.title && previous.parentId === (session.parentId ?? null)) continue

        const messages = await readArchiveSource(signal, (requestSignal) => runtime.listMessages(session.id, { signal: requestSignal }))
        if (!messages.ok) return messages
        if (messages.data.some((message) => message.sessionId !== session.id)) {
          return harnessFailure('runtime_error', `Legacy message workspace/session mismatch: ${session.id}`)
        }
        const current = await readArchiveSource(signal, () => runtime.getSession(session.id))
        if (!current.ok) return current
        const statusAfter = await readArchiveSource(signal, (requestSignal) => runtime.sessionStatus({ signal: requestSignal }))
        if (!statusAfter.ok) return statusAfter
        if ((statusAfter.data[session.id]?.type ?? 'idle') !== 'idle' ||
          !sameSession(current.data, session)) {
          if (skipUnstable) continue
          return harnessFailure('session_busy', `Legacy session changed during export: ${session.id}`)
        }

        signal.throwIfAborted()
        const saved = await legacySessionArchive.withArchiveWriteFence(slug, async (tx): Promise<HarnessResult<number>> => {
          signal.throwIfAborted()
          const snapshot = {
            slug,
            sessionId: session.id,
            parentId: session.parentId ?? null,
            title: session.title,
            createdAt,
            updatedAt,
            messages: messages.data,
            validatedAt: skipUnstable ? null : new Date(),
          }
          signal.throwIfAborted()
          const written = await legacySessionArchive.upsertSession(snapshot, {}, tx)
          signal.throwIfAborted()
          return { ok: true, data: written ? 1 : 0 }
        }, { onlyWhileRunning: skipUnstable })
        if (!saved) {
          if (skipUnstable) continue
          return harnessFailure('session_busy', 'Legacy export lost the V1 instance')
        }
        if (!saved.ok) return saved
        archived += saved.data
      }

      if (!skipUnstable) {
        const inventory = await readInventory(runtime, signal)
        if (!inventory.ok) return inventory
        if (inventory.data.size !== seen.size || [...seen].some(([id, session]) => {
          const current = inventory.data.get(id)
          return !current || !sameSession(session, current)
        })) return harnessFailure('session_busy', 'Legacy inventory changed during export')
        const statuses = await readArchiveSource(signal, (requestSignal) => runtime.sessionStatus({ signal: requestSignal }))
        if (!statuses.ok) return statuses
        if ([...inventory.data.keys()].some((id) => (statuses.data[id]?.type ?? 'idle') !== 'idle')) {
          return harnessFailure('session_busy', 'Legacy inventory is not idle')
        }
        signal.throwIfAborted()
        const reconciled = await legacySessionArchive.withArchiveWriteFence(slug, async (tx): Promise<HarnessResult<void>> => {
          signal.throwIfAborted()
          await legacySessionArchive.reconcileSessions(slug, [...inventory.data.keys()], tx)
          signal.throwIfAborted()
          return { ok: true, data: undefined }
        })
        if (!reconciled) return harnessFailure('session_busy', 'Legacy reconciliation lost the V1 instance')
        if (!reconciled.ok) return reconciled
      }

      return { ok: true, data: { archived } }
    })
  } catch (error) {
    return harnessFailure('runtime_error', `Legacy session export failed for ${slug}: ${error instanceof Error ? error.message : String(error)}`)
  }
}

export async function preArchiveRunningV1Instances(): Promise<number> {
  if (preArchiveRunning || Date.now() - lastPreArchiveStartedAt < PRE_ARCHIVE_INTERVAL_MS) return 0
  preArchiveRunning = true
  lastPreArchiveStartedAt = Date.now()
  let slug: string | undefined
  try {
    const instance = await legacySessionArchive.findNextRunningV1Instance(lastPreArchiveSlug)
    if (!instance) return 0
    slug = instance.slug
    lastPreArchiveSlug = slug
    const connection = await getRuntimeConnection(slug)
    const result = connection
      ? await exportSessions(slug, getLegacySessionReader(slug, connection), true)
      : harnessFailure('instance_unavailable', 'legacy_connection_unavailable')
    if (!result.ok) {
      console.warn('[legacy-session-archive] Pre-archive failed:', { slug, error: result.error })
      return 0
    }
    console.info('[legacy-session-archive] Pre-archived workspace:', { slug, archived: result.data.archived })
    return result.data.archived
  } catch (error) {
    console.warn('[legacy-session-archive] Pre-archive failed:', { slug, error })
    return 0
  } finally {
    preArchiveRunning = false
  }
}

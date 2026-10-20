import { isDeepStrictEqual } from 'node:util'

import type { HarnessRuntime, HarnessSession } from '@/lib/harness/contract'
import { harnessFailure, type HarnessResult } from '@/lib/harness/errors'
import { getRuntimeForSlug } from '@/lib/harness/registry'
import { createEventStrict } from '@/lib/services/audit'
import * as legacySessionArchive from '@/lib/services/legacy-session-archive'

export const PRE_ARCHIVE_INTERVAL_MS = 5 * 60 * 1000

let preArchiveRunning = false
let lastPreArchiveStartedAt = -Infinity
let lastPreArchiveSlug: string | undefined

export async function exportLegacySessions(slug: string, runtime: HarnessRuntime): Promise<HarnessResult<{ archived: number }>> {
  return exportSessions(slug, runtime, false)
}

export async function deleteLegacySession(slug: string, runtime: HarnessRuntime, sessionId: string, actorUserId?: string): Promise<HarnessResult<void>> {
  if (runtime.kind !== 'opencode-v1' || runtime.slug !== slug) return harnessFailure('runtime_error', 'Legacy deletion workspace/runtime mismatch')
  try {
    const result = await legacySessionArchive.withArchiveWriteFence(slug, async (tx) => {
      const pending = [sessionId]
      const seen = new Set<string>()
      for (let index = 0; index < pending.length; index++) {
        const id = pending[index]
        if (seen.has(id)) continue
        seen.add(id)
        const children = await runtime.listChildren(id)
        if (!children.ok && children.error.code !== 'session_not_found') return children
        if (children.ok) pending.push(...children.data.map((child) => child.id))
      }
      const deleted = await runtime.deleteSession(sessionId)
      if (!deleted.ok && deleted.error.code !== 'session_not_found') return deleted
      await legacySessionArchive.deleteSessionTree(slug, [...seen], tx)
      await createEventStrict({ actorUserId, action: 'workspace.session.deleted', metadata: JSON.stringify({ slug, sessionIds: [...seen] }) }, tx)
      return deleted
    }, { onlyWhileRunning: true })
    return result ?? harnessFailure('session_busy', 'Legacy deletion lost the running V1 instance')
  } catch (error) {
    return harnessFailure('runtime_error', `Legacy session deletion failed for ${slug}: ${error instanceof Error ? error.message : String(error)}`)
  }
}

async function readInventory(runtime: HarnessRuntime): Promise<HarnessResult<Map<string, HarnessSession>>> {
  const listed = await runtime.listSessions({ rootsOnly: false, limit: Number.MAX_SAFE_INTEGER })
  if (!listed.ok) return listed
  const pending = [...listed.data]
  const inventory = new Map<string, HarnessSession>()
  for (let index = 0; index < pending.length; index++) {
    const session = pending[index]
    if (inventory.has(session.id)) continue
    inventory.set(session.id, session)
    const children = await runtime.listChildren(session.id)
    if (!children.ok) return children
    pending.push(...children.data)
  }
  return { ok: true, data: inventory }
}

function sameSession(left: HarnessSession, right: HarnessSession): boolean {
  return left.id === right.id && left.createdAtRaw === right.createdAtRaw &&
    left.updatedAtRaw === right.updatedAtRaw && left.title === right.title && left.parentId === right.parentId
}

async function exportSessions(slug: string, runtime: HarnessRuntime, skipUnstable: boolean): Promise<HarnessResult<{ archived: number }>> {
  if (runtime.kind !== 'opencode-v1') return harnessFailure('runtime_unsupported', 'Legacy export requires opencode-v1')
  if (runtime.slug !== slug) return harnessFailure('runtime_error', 'Legacy export workspace mismatch')

  try {
    const listed = await runtime.listSessions({ rootsOnly: false, limit: Number.MAX_SAFE_INTEGER })
    if (!listed.ok) return listed
    const pending = [...listed.data]
    const seen = new Map<string, HarnessSession>()
    let archived = 0

    for (let index = 0; index < pending.length; index++) {
      const session = pending[index]
      if (seen.has(session.id)) continue
      seen.set(session.id, session)

      const children = await runtime.listChildren(session.id)
      if (!children.ok) return children
      pending.push(...children.data)

      const saved = await legacySessionArchive.withArchiveWriteFence(slug, async (tx): Promise<HarnessResult<number>> => {
        const createdAt = new Date(session.createdAtRaw ?? NaN)
        const updatedAt = new Date(session.updatedAtRaw ?? NaN)
        if (!Number.isFinite(createdAt.getTime()) || !Number.isFinite(updatedAt.getTime())) {
          return harnessFailure('runtime_error', `Missing raw legacy session timestamps: ${session.id}`)
        }

        const statusBefore = await runtime.sessionStatus()
        if (!statusBefore.ok) return statusBefore
        if ((statusBefore.data[session.id]?.type ?? 'idle') !== 'idle') {
          if (skipUnstable) return { ok: true, data: 0 }
          return harnessFailure('session_busy', `Legacy session is not idle: ${session.id}`)
        }

        const messages = await runtime.listMessages(session.id)
        if (!messages.ok) return messages
        if (messages.data.some((message) => message.sessionId !== session.id)) {
          return harnessFailure('runtime_error', `Legacy message workspace/session mismatch: ${session.id}`)
        }
        const current = await runtime.getSession(session.id)
        if (!current.ok) return current
        const statusAfter = await runtime.sessionStatus()
        if (!statusAfter.ok) return statusAfter
        if ((statusAfter.data[session.id]?.type ?? 'idle') !== 'idle' ||
          !sameSession(current.data, session)) {
          if (skipUnstable) return { ok: true, data: 0 }
          return harnessFailure('session_busy', `Legacy session changed during export: ${session.id}`)
        }

        const previous = await legacySessionArchive.findExportedSession(slug, session.id, tx)
        if (previous && previous.updatedAt.getTime() === updatedAt.getTime() &&
          previous.createdAt.getTime() === createdAt.getTime() &&
          previous.title === session.title && previous.parentId === (session.parentId ?? null) &&
          isDeepStrictEqual(previous.messages, JSON.parse(JSON.stringify(messages.data)))) return { ok: true, data: 0 }

        const snapshot = {
          slug,
          sessionId: session.id,
          parentId: session.parentId ?? null,
          title: session.title,
          createdAt,
          updatedAt,
          messages: messages.data,
        }
        const written = await legacySessionArchive.upsertSession(snapshot, {}, tx)
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
      const reconciled = await legacySessionArchive.withArchiveWriteFence(slug, async (tx): Promise<HarnessResult<void>> => {
        const inventory = await readInventory(runtime)
        if (!inventory.ok) return inventory
        if (inventory.data.size !== seen.size || [...seen].some(([id, session]) => {
          const current = inventory.data.get(id)
          return !current || !sameSession(session, current)
        })) return harnessFailure('session_busy', 'Legacy inventory changed during export')
        const statuses = await runtime.sessionStatus()
        if (!statuses.ok) return statuses
        if ([...inventory.data.keys()].some((id) => (statuses.data[id]?.type ?? 'idle') !== 'idle')) {
          return harnessFailure('session_busy', 'Legacy inventory is not idle')
        }
        await legacySessionArchive.reconcileSessions(slug, [...inventory.data.keys()], tx)
        return { ok: true, data: undefined }
      })
      if (!reconciled) return harnessFailure('session_busy', 'Legacy reconciliation lost the V1 instance')
      if (!reconciled.ok) return reconciled
    }

    return { ok: true, data: { archived } }
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
    const runtime = await getRuntimeForSlug(slug)
    const result = runtime.ok ? await exportSessions(slug, runtime.data, true) : runtime
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

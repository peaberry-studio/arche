import { isDeepStrictEqual } from 'node:util'

import type { HarnessRuntime } from '@/lib/harness/contract'
import { harnessFailure, type HarnessResult } from '@/lib/harness/errors'
import { getRuntimeForSlug } from '@/lib/harness/registry'
import * as legacySessionArchive from '@/lib/services/legacy-session-archive'

export const PRE_ARCHIVE_INTERVAL_MS = 5 * 60 * 1000

let preArchiveRunning = false
let lastPreArchiveStartedAt = -Infinity
let lastPreArchiveSlug: string | undefined

export async function exportLegacySessions(slug: string, runtime: HarnessRuntime): Promise<HarnessResult<{ archived: number }>> {
  return exportSessions(slug, runtime, false)
}

async function exportSessions(slug: string, runtime: HarnessRuntime, skipUnstable: boolean): Promise<HarnessResult<{ archived: number }>> {
  if (runtime.kind !== 'opencode-v1') return harnessFailure('runtime_unsupported', 'Legacy export requires opencode-v1')
  if (runtime.slug !== slug) return harnessFailure('runtime_error', 'Legacy export workspace mismatch')

  try {
    const listed = await runtime.listSessions({ rootsOnly: false, limit: Number.MAX_SAFE_INTEGER })
    if (!listed.ok) return listed
    const pending = [...listed.data]
    const seen = new Set<string>()
    let archived = 0

    for (let index = 0; index < pending.length; index++) {
      const session = pending[index]
      if (seen.has(session.id)) continue
      seen.add(session.id)

      const children = await runtime.listChildren(session.id)
      if (!children.ok) return children
      pending.push(...children.data)

      const createdAt = new Date(session.createdAtRaw ?? NaN)
      const updatedAt = new Date(session.updatedAtRaw ?? NaN)
      if (!Number.isFinite(createdAt.getTime()) || !Number.isFinite(updatedAt.getTime())) {
        return harnessFailure('runtime_error', `Missing raw legacy session timestamps: ${session.id}`)
      }

      const statusBefore = await runtime.sessionStatus()
      if (!statusBefore.ok) return statusBefore
      if ((statusBefore.data[session.id]?.type ?? 'idle') !== 'idle') {
        if (skipUnstable) continue
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
        current.data.id !== session.id || current.data.createdAtRaw !== session.createdAtRaw ||
        current.data.updatedAtRaw !== session.updatedAtRaw || current.data.title !== session.title ||
        current.data.parentId !== session.parentId) {
        if (skipUnstable) continue
        return harnessFailure('session_busy', `Legacy session changed during export: ${session.id}`)
      }

      const previous = await legacySessionArchive.findExportedSession(slug, session.id)
      if (previous && previous.updatedAt.getTime() === updatedAt.getTime() &&
        previous.createdAt.getTime() === createdAt.getTime() &&
        previous.title === session.title && previous.parentId === (session.parentId ?? null) &&
        isDeepStrictEqual(previous.messages, JSON.parse(JSON.stringify(messages.data)))) continue

      const snapshot = {
        slug,
        sessionId: session.id,
        parentId: session.parentId ?? null,
        title: session.title,
        createdAt,
        updatedAt,
        messages: messages.data,
      }
      const written = skipUnstable
        ? await legacySessionArchive.upsertSession(snapshot, { onlyWhileRunning: true })
        : await legacySessionArchive.upsertSession(snapshot)
      if (written) archived++
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

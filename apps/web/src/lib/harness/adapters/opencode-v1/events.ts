import { formatTimestamp } from '@/lib/format-timestamp'
import { getInstanceBasicAuth } from '@/lib/harness/adapters/opencode-v1/client'
import { isWorkspaceTouchEvent, type OpenCodeEvent } from '@/lib/harness/adapters/opencode-v1/opencode-event'
import { getPermissionEventPayload, normalizePendingPermission } from '@/lib/harness/adapters/opencode-v1/permission'
import { extractTextContent, transformParts } from '@/lib/harness/adapters/opencode-v1/transform'
import type { ArcheEvent } from '@/lib/harness/events'
import { harnessFailure, type HarnessResult } from '@/lib/harness/errors'
import { getString, isRecord } from '@/lib/records'
import { INITIAL_SSE_PARSE_STATE, parseSseChunk } from '@/lib/sse-parser'
import type { WorkspaceMessage } from '@/types/workspace-runtime'

function getNumber(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined
}

function getEventSessionId(properties: Record<string, unknown>): string | undefined {
  for (const value of [properties, properties.info, properties.permission, properties.part]) {
    if (!isRecord(value)) continue
    const id = getString(value.sessionID) ?? getString(value.sessionId)
    if (id) return id
  }
  return undefined
}

export function toWorkspaceMessage(info: Record<string, unknown>): WorkspaceMessage | null {
  const id = getString(info.id)
  const role = info.role
  const sessionId = getString(info.sessionID) ?? getString(info.sessionId)
  if (!id || !sessionId || (role !== 'user' && role !== 'assistant' && role !== 'system')) return null
  const parts = transformParts(Array.isArray(info.parts) ? info.parts : [])
  const time = isRecord(info.time) ? info.time : {}
  const timestampRaw = getNumber(time.created)
  const completedAt = getNumber(time.completed)
  const model = isRecord(info.model) ? info.model : {}
  const providerId = getString(info.providerID) ?? getString(model.providerID)
  const modelId = getString(info.modelID) ?? getString(model.modelID)
  const agentId = getString(info.agent)
  return {
    id, sessionId, role,
    ...(agentId && { agentId }),
    ...(providerId && modelId ? { model: { providerId, modelId } } : {}),
    content: role === 'user' ? parts.find((part) => part.type === 'text')?.text ?? '' : extractTextContent(parts),
    timestamp: formatTimestamp(timestampRaw),
    ...(timestampRaw !== undefined && { timestampRaw }),
    ...(completedAt !== undefined && completedAt > 0 && { completedAt }),
    parts,
  }
}

export function translateOpenCodeEvent(event: OpenCodeEvent): ArcheEvent[] {
  const properties = isRecord(event.properties) ? event.properties : {}
  const info = isRecord(properties.info) ? properties.info : {}
  const sessionId = getEventSessionId(properties)
  switch (event.type) {
    case 'session.status':
    case 'session.idle': {
      const id = sessionId ?? getString(info.id)
      if (!id) return []
      const status = isRecord(properties.status) ? properties.status : {}
      return [{ v: 1, type: 'session.status', sessionId: id, status: event.type === 'session.idle' || status.type === 'idle' ? 'idle' : 'busy' }]
    }
    case 'session.error': {
      const id = sessionId ?? getString(info.id)
      if (!id) return []
      const error = isRecord(properties.error) ? properties.error : {}
      const data = isRecord(error.data) ? error.data : {}
      const message = getString(data.message) ?? getString(error.message) ?? getString(properties.message)
      return [{ v: 1, type: 'session.error', sessionId: id, ...(message && { message }) }]
    }
    case 'session.created':
    case 'session.updated': {
      const session = isRecord(properties.info) ? properties.info : isRecord(properties.session) ? properties.session : {}
      const id = getString(session.id)
      if (!id) return []
      const title = getString(session.title)
      const parentId = getString(session.parentID) ?? getString(session.parentId)
      return [{ v: 1, type: 'session.upserted', session: { id, ...(title && { title }), ...(parentId && { parentId }) } }]
    }
    case 'session.deleted': {
      const id = getString(info.id) ?? sessionId
      return id ? [{ v: 1, type: 'session.removed', sessionId: id }] : []
    }
    case 'message.updated': {
      const message = toWorkspaceMessage(info)
      return message ? [{ v: 1, type: 'message.upserted', message }] : []
    }
    case 'message.removed': {
      const messageId = getString(properties.messageID) ?? getString(properties.id) ?? getString(info.id)
      return messageId ? [{ v: 1, type: 'message.removed', messageId }] : []
    }
    case 'message.part.updated': {
      if (!isRecord(properties.part)) return []
      const messageId = getString(properties.part.messageID)
      const part = transformParts([properties.part])[0]
      return messageId && part ? [{ v: 1, type: 'part.upserted', ...(sessionId && { sessionId }), messageId, part }] : []
    }
    case 'message.part.delta': {
      const messageId = getString(properties.messageID)
      const partId = getString(properties.partID) ?? getString(properties.id)
      const field = getString(properties.field) ?? getString(properties.partType) ?? 'text'
      const part = isRecord(properties.part) ? properties.part : {}
      const delta = [properties.delta, part.delta, properties.text, properties.value, part.text, part.value].find((value) => typeof value === 'string')
      return messageId && partId && typeof delta === 'string' && (field === 'text' || field === 'reasoning')
        ? [{ v: 1, type: 'part.delta', ...(sessionId && { sessionId }), messageId, partId, field, delta }] : []
    }
    case 'message.part.removed': {
      const messageId = getString(properties.messageID)
      const partId = getString(properties.partID) ?? getString(properties.id)
      return messageId && partId ? [{ v: 1, type: 'part.removed', ...(sessionId && { sessionId }), messageId, partId }] : []
    }
    case 'permission.asked':
    case 'permission.updated':
    case 'permission.v2.asked': {
      const permission = normalizePendingPermission(getPermissionEventPayload(event))
      return permission ? [{ v: 1, type: 'permission.asked', permission }] : []
    }
    case 'permission.replied':
    case 'permission.v2.replied': {
      const permission = getPermissionEventPayload(event)
      const id = sessionId ?? getString(permission?.sessionID) ?? getString(permission?.sessionId)
      const permissionId = getString(properties.requestID) ?? getString(permission?.id) ?? getString(properties.permissionID) ?? getString(properties.permissionId)
      return id && permissionId ? [{ v: 1, type: 'permission.resolved', sessionId: id, permissionId }] : []
    }
    default:
      return isWorkspaceTouchEvent(event.type) ? [{ v: 1, type: 'workspace.touched' }] : []
  }
}

export async function* translateEventStream(body: ReadableStream<Uint8Array>, signal: AbortSignal): AsyncGenerator<ArcheEvent> {
  const reader = body.getReader()
  const decoder = new TextDecoder()
  let state = INITIAL_SSE_PARSE_STATE
  const cancel = () => { void reader.cancel().catch(() => undefined) }
  signal.addEventListener('abort', cancel, { once: true })
  try {
    while (!signal.aborted) {
      const { done, value } = await reader.read()
      if (done) break
      const parsed = parseSseChunk(state, decoder.decode(value, { stream: true }))
      state = parsed.state
      for (const frame of parsed.events) {
        let event: unknown
        try { event = JSON.parse(frame.data) } catch { continue }
        if (!isRecord(event) || typeof event.type !== 'string') continue
        yield* translateOpenCodeEvent({ type: event.type, ...(isRecord(event.properties) && { properties: event.properties }) })
      }
    }
  } finally {
    signal.removeEventListener('abort', cancel)
    await reader.cancel().catch(() => undefined)
    reader.releaseLock()
  }
}

export async function subscribeOpenCodeEvents(slug: string, signal: AbortSignal): Promise<HarnessResult<AsyncIterable<ArcheEvent>>> {
  try {
    const connection = await getInstanceBasicAuth(slug)
    if (!connection) return harnessFailure('instance_unavailable')
    const response = await fetch(`${connection.baseUrl}/event`, {
      headers: { Authorization: connection.authHeader, Accept: 'text/event-stream', 'Cache-Control': 'no-cache' },
      signal,
    })
    if (!response.ok || !response.body) {
      await response.body?.cancel()
      return harnessFailure('event_stream_unavailable')
    }
    return { ok: true, data: translateEventStream(response.body, signal) }
  } catch (error) {
    return harnessFailure('event_stream_unavailable', error instanceof Error ? error.message : undefined)
  }
}

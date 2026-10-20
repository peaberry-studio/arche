import { OpenCode, type OpenCodeEvent } from '@opencode/client'

import { formatTimestamp } from '@/lib/format-timestamp'
import { getInstanceBasicAuth } from '@/lib/harness/adapters/opencode-v2/client'
import { accountingPart, contentPartId, toArchePermission, toHarnessError, toHarnessMessage, toolResultParts } from '@/lib/harness/adapters/opencode-v2/transform'
import { harnessFailure, type HarnessResult } from '@/lib/harness/errors'
import type { ArcheEvent } from '@/lib/harness/events'

function unsupported(type: string): HarnessResult<ArcheEvent[]> {
  return harnessFailure('runtime_unsupported', `UNVERIFIED: ${type} cannot be represented losslessly by the current Arche event schema/reducer`)
}

export function translateOpenCodeEvent(event: OpenCodeEvent): HarnessResult<ArcheEvent[]> {
  const output: ArcheEvent[] = []
  switch (event.type) {
    case 'session.created':
      output.push({ v: 1, type: 'session.upserted', session: {
        id: event.data.sessionID,
        ...(typeof event.data.title === 'string' && { title: event.data.title }),
        ...(typeof event.data.parentID === 'string' && { parentId: event.data.parentID }),
      } })
      break
    case 'session.renamed':
      output.push({ v: 1, type: 'session.upserted', replace: true, session: { id: event.data.sessionID, title: event.data.title } })
      break
    case 'session.forked':
      output.push({ v: 1, type: 'session.upserted', session: { id: event.data.sessionID, parentId: event.data.parentID } })
      break
    case 'session.deleted':
      output.push({ v: 1, type: 'session.removed', sessionId: event.data.sessionID })
      break
    case 'session.execution.started':
      output.push({ v: 1, type: 'session.status', sessionId: event.data.sessionID, status: 'busy' })
      break
    case 'session.execution.succeeded':
    case 'session.execution.interrupted':
      output.push({ v: 1, type: 'session.status', sessionId: event.data.sessionID, status: 'idle' })
      break
    case 'session.execution.failed':
      output.push({ v: 1, type: 'session.error', sessionId: event.data.sessionID, message: toHarnessError(event.data.error)?.detail ?? event.data.error.message })
      output.push({ v: 1, type: 'session.status', sessionId: event.data.sessionID, status: 'idle' })
      break
    case 'session.status':
      output.push({ v: 1, type: 'session.status', sessionId: event.data.sessionID, status: event.data.status.type === 'idle' ? 'idle' : 'busy' })
      break
    case 'session.idle':
      output.push({ v: 1, type: 'session.status', sessionId: event.data.sessionID, status: 'idle' })
      break
    case 'session.step.started': {
      const message = toHarnessMessage({ id: event.data.assistantMessageID, sessionID: event.data.sessionID,
        type: 'assistant', agent: event.data.agent, model: event.data.model,
        time: { created: event.data.started }, content: [],
      })
      if (!message) return unsupported(event.type)
      output.push({ v: 1, type: 'message.upserted', message })
      output.push({ v: 1, type: 'message.upserted', mode: 'patch', sessionId: message.sessionId, messageId: message.id, patch: {}, reset: true })
      break
    }
    case 'session.text.started':
    case 'session.reasoning.started':
    case 'session.text.ended':
    case 'session.reasoning.ended': {
      const kind = event.type.startsWith('session.reasoning.') ? 'reasoning' : 'text'
      const text = 'text' in event.data ? event.data.text : ''
      output.push({ v: 1, type: 'part.upserted', sessionId: event.data.sessionID, messageId: event.data.assistantMessageID,
        part: { type: kind, id: contentPartId(event.data.assistantMessageID, kind, event.data.ordinal), text },
        replace: event.type.endsWith('.ended'),
      })
      break
    }
    case 'session.text.delta':
    case 'session.reasoning.delta': {
      const field = event.type === 'session.text.delta' ? 'text' : 'reasoning'
      output.push({ v: 1, type: 'part.delta', sessionId: event.data.sessionID, messageId: event.data.assistantMessageID,
        partId: contentPartId(event.data.assistantMessageID, field, event.data.ordinal), field, delta: event.data.delta,
      })
      break
    }
    case 'permission.asked': {
      const permission = toArchePermission(event.data)
      if (!permission) return unsupported(event.type)
      output.push({ v: 1, type: 'permission.asked', permission })
      break
    }
    case 'permission.replied':
      output.push({ v: 1, type: 'permission.resolved', sessionId: event.data.sessionID, permissionId: event.data.requestID })
      break
    case 'filesystem.changed':
      output.push({ v: 1, type: 'workspace.touched' })
      break
    case 'session.inbox.enqueued': {
      const { item, sessionID, inboxID } = event.data
      if (item.type !== 'user' && item.type !== 'synthetic') break
      const message = toHarnessMessage({ ...item.payload, id: inboxID, sessionID, type: item.type, time: { created: event.created } })
      if (!message) return unsupported(event.type)
      output.push({ v: 1, type: 'message.upserted', mode: 'stage', message })
      break
    }
    case 'session.synthetic':
    case 'session.instructions.updated': {
      if (event.data.text === undefined) break
      const message = toHarnessMessage({ id: event.id.replace(/^evt_/, 'msg_'), sessionID: event.data.sessionID,
        type: event.type === 'session.synthetic' ? 'synthetic' : 'system', text: event.data.text, time: { created: event.created } })
      if (!message) return unsupported(event.type)
      output.push({ v: 1, type: 'message.upserted', message })
      break
    }
    case 'session.inbox.delivered':
      output.push({ v: 1, type: 'message.upserted', mode: 'commit', sessionId: event.data.sessionID, messageId: event.data.inboxID, timestamp: formatTimestamp(event.created), timestampRaw: event.created })
      break
    case 'session.inbox.cancelled':
      output.push({ v: 1, type: 'message.removed', mode: 'staged', sessionId: event.data.sessionID, messageId: event.data.inboxID })
      break
    case 'session.step.streamed':
      break
    case 'session.step.ended':
    case 'session.step.failed': {
      const data = event.data
      const error = 'error' in data ? toHarnessError(data.error) : undefined
      const usage = accountingPart(data.assistantMessageID, data)
      output.push({ v: 1, type: 'message.upserted', mode: 'patch', sessionId: data.sessionID, messageId: data.assistantMessageID,
        patch: { completedAt: event.created, ...(error && { error, statusInfo: { status: 'error', detail: error.detail } }) },
        ...(usage && { parts: [usage] }),
        ...('error' in data && { removeParts: [`${data.assistantMessageID}:retry`] }),
      })
      if (data.files?.length) output.push({ v: 1, type: 'workspace.touched' })
      break
    }
    case 'session.tool.input.started':
      output.push({ v: 1, type: 'part.upserted', mode: 'tool-patch', sessionId: event.data.sessionID, messageId: event.data.assistantMessageID,
        update: { id: event.data.id, name: event.data.name, status: 'pending', rawInput: '' } })
      break
    case 'session.tool.input.delta':
      output.push({ v: 1, type: 'part.upserted', mode: 'tool-patch', sessionId: event.data.sessionID, messageId: event.data.assistantMessageID,
        update: { id: event.data.id, inputDelta: event.data.delta } })
      break
    case 'session.tool.input.ended':
      output.push({ v: 1, type: 'part.upserted', mode: 'tool-patch', sessionId: event.data.sessionID, messageId: event.data.assistantMessageID,
        update: { id: event.data.id, rawInput: event.data.text } })
      break
    case 'session.tool.called':
      output.push({ v: 1, type: 'part.upserted', mode: 'tool-patch', sessionId: event.data.sessionID, messageId: event.data.assistantMessageID,
        update: { id: event.data.id, status: 'running', input: event.data.input, metadata: {} } })
      break
    case 'session.tool.progress':
      output.push({ v: 1, type: 'part.upserted', mode: 'tool-patch', sessionId: event.data.sessionID, messageId: event.data.assistantMessageID,
        update: { id: event.data.id, metadata: event.data.metadata } })
      break
    case 'session.tool.success':
    case 'session.tool.failed': {
      const data = event.data
      const result = toolResultParts(data.id, data.content ?? [])
      const error = 'error' in data ? toHarnessError(data.error) : undefined
      output.push({ v: 1, type: 'part.upserted', mode: 'tool-patch', sessionId: data.sessionID, messageId: data.assistantMessageID,
        update: { id: data.id, status: error ? 'error' : 'completed', ...(error ? { error: error.detail } : { output: result.output }), metadata: data.metadata ?? null },
        attachments: result.attachments,
      })
      break
    }
    case 'session.retry.scheduled': {
      const error = toHarnessError(event.data.error)
      output.push({ v: 1, type: 'message.upserted', mode: 'patch', sessionId: event.data.sessionID, messageId: event.data.assistantMessageID, patch: {},
        parts: [{ type: 'retry', id: `${event.data.assistantMessageID}:retry`, attempt: event.data.attempt, error: error?.detail ?? event.data.error.message }] })
      break
    }
    default:
      break
  }
  return { ok: true, data: output.map((translated) => 'messageId' in translated && 'created' in event ? { ...translated, at: event.created } : translated) }
}

export const V2_EVENT_STREAM_UNVERIFIED = 'UNVERIFIED: v2_event_snapshot_parity:unfinished_snapshot_delta_overlap,missed_inbox_enqueue_on_reconnect,full_session_control_parity'

export async function subscribeOpenCodeEvents(_slug: string, _signal: AbortSignal): Promise<HarnessResult<AsyncIterable<ArcheEvent>>> {
  return harnessFailure('runtime_unsupported', V2_EVENT_STREAM_UNVERIFIED)
}

export async function connectOpenCodeEvents(slug: string, signal: AbortSignal): Promise<HarnessResult<AsyncIterable<ArcheEvent>>> {
  let iterator: AsyncIterator<OpenCodeEvent> | undefined
  try {
    const connection = await getInstanceBasicAuth(slug)
    if (!connection) return harnessFailure('instance_unavailable')
    const ready = Promise.withResolvers<void>()
    const client = OpenCode.make({ baseUrl: connection.baseUrl, headers: { Authorization: connection.authHeader },
      fetch: async (input, options) => {
        const response = await fetch(input, options)
        if (new URL(String(input)).pathname === '/api/event') {
          if (!response.ok || !response.body || !response.headers.get('Content-Type')?.startsWith('text/event-stream')) {
            ready.reject(new Error(`Event stream rejected: ${response.status}`))
          } else ready.resolve()
        }
        return response
      },
    })
    const location = await client.location.get(undefined, { signal })
    const sessionIds = new Set<string>()
    const cursors = new Set<string>()
    let cursor: string | undefined
    for (;;) {
      const page = await client.session.list({ directory: location.directory, limit: 100, cursor }, { signal })
      for (const session of page.data) sessionIds.add(session.id)
      if (!page.cursor.next) break
      if (cursors.has(page.cursor.next)) throw new Error('Event scope pagination repeated')
      cursor = page.cursor.next
      cursors.add(cursor)
    }
    iterator = client.event.subscribe({ signal })[Symbol.asyncIterator]()
    const first = iterator.next()
    void first.then((result) => { if (result.done) ready.reject(new Error('Event subscription closed')) }, (error: unknown) => ready.reject(error))
    await ready.promise
    if (signal.aborted) throw new Error('Event subscription cancelled')
    const source = iterator
    async function* translate(): AsyncGenerator<ArcheEvent> {
      try {
        let current = await first
        while (!current.done && !signal.aborted) {
          const event = current.value
          const sessionId = 'sessionID' in event.data && typeof event.data.sessionID === 'string' ? event.data.sessionID : undefined
          const inLocation = event.location?.directory === location.directory
          if (inLocation && sessionId) sessionIds.add(sessionId)
          if (event.type === 'session.moved') {
            if (event.data.location.directory === location.directory) sessionIds.add(event.data.sessionID)
            else sessionIds.delete(event.data.sessionID)
          }
          if (inLocation || (!event.location && sessionId && sessionIds.has(sessionId))) {
            const translated = translateOpenCodeEvent(event)
            if (!translated.ok) throw new Error(translated.error.detail)
            yield* translated.data
          }
          if (event.type === 'session.deleted') sessionIds.delete(event.data.sessionID)
          current = await source.next()
        }
      } finally {
        await source.return?.()
      }
    }
    return { ok: true, data: translate() }
  } catch (error) {
    await iterator?.return?.()
    return harnessFailure('event_stream_unavailable', error instanceof Error ? error.message : undefined)
  }
}

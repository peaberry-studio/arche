import type { OpenCodeEvent } from '@opencode/client'

import { contentPartId, toArchePermission, toHarnessMessage } from '@/lib/harness/adapters/opencode-v2/transform'
import { harnessFailure, type HarnessResult } from '@/lib/harness/errors'
import type { ArcheEvent } from '@/lib/harness/events'

export const V2_EVENT_STREAM_UNVERIFIED = 'UNVERIFIED: OpenCode 2.0.32 partial tool/step/content events require Arche-owned patch semantics; full-object upserts would invent missing fields or lose metadata. Subscription is disabled until reducer/snapshot parity is verified.'

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
      output.push({ v: 1, type: 'session.error', sessionId: event.data.sessionID, message: event.data.error.message })
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
    case 'session.inbox.enqueued':
    case 'session.inbox.delivered':
    case 'session.inbox.cancelled':
    case 'session.step.streamed':
    case 'session.step.ended':
    case 'session.step.failed':
    case 'session.tool.input.started':
    case 'session.tool.input.delta':
    case 'session.tool.input.ended':
    case 'session.tool.called':
    case 'session.tool.progress':
    case 'session.tool.success':
    case 'session.tool.failed':
    case 'session.renamed':
    case 'session.retry.scheduled':
      return unsupported(event.type)
    default:
      break
  }
  return { ok: true, data: output }
}

export async function subscribeOpenCodeEvents(_slug: string, _signal: AbortSignal): Promise<HarnessResult<AsyncIterable<ArcheEvent>>> {
  return harnessFailure('runtime_unsupported', V2_EVENT_STREAM_UNVERIFIED)
}

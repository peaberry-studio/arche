import type { ArcheEvent } from '@/lib/harness/events'
import { isRecord } from '@/lib/records'

function isPart(value: unknown): boolean {
  if (!isRecord(value) || (value.id !== undefined && typeof value.id !== 'string')) return false
  switch (value.type) {
    case 'text':
    case 'reasoning':
      return typeof value.text === 'string'
    case 'file':
      return typeof value.path === 'string'
    case 'image':
      return typeof value.url === 'string'
    case 'tool': {
      const state = value.state
      if (typeof value.id !== 'string' || typeof value.name !== 'string' || !isRecord(state) || !isRecord(state.input)) return false
      switch (state.status) {
        case 'pending':
        case 'running': return true
        case 'completed': return typeof state.output === 'string' && typeof state.title === 'string'
        case 'error': return typeof state.error === 'string'
        default: return false
      }
    }
    case 'permission':
      return typeof value.id === 'string' && typeof value.permissionId === 'string' && typeof value.sessionId === 'string' && typeof value.title === 'string' && (value.state === 'pending' || value.state === 'approved' || value.state === 'rejected')
    case 'step-start':
      return typeof value.id === 'string'
    case 'step-finish':
      return typeof value.id === 'string' && typeof value.reason === 'string' && typeof value.cost === 'number' && isRecord(value.tokens) && typeof value.tokens.input === 'number' && typeof value.tokens.output === 'number'
    case 'patch':
      return typeof value.id === 'string' && Array.isArray(value.files) && value.files.every((file) => typeof file === 'string')
    case 'agent':
      return typeof value.id === 'string' && typeof value.name === 'string'
    case 'subtask':
      return typeof value.id === 'string' && typeof value.prompt === 'string' && typeof value.description === 'string' && typeof value.agent === 'string'
    case 'retry':
      return typeof value.id === 'string' && typeof value.attempt === 'number' && typeof value.error === 'string'
    case 'unknown':
      return typeof value.originalType === 'string' && isRecord(value.data)
    default:
      return false
  }
}

function isArcheEvent(event: unknown): event is ArcheEvent {
  if (!isRecord(event) || event.v !== 1) return false
  switch (event.type) {
    case 'session.status':
      return typeof event.sessionId === 'string' && (event.status === 'busy' || event.status === 'idle')
    case 'session.error':
      return typeof event.sessionId === 'string' && (event.message === undefined || typeof event.message === 'string')
    case 'session.removed':
      return typeof event.sessionId === 'string'
    case 'session.upserted':
      return isRecord(event.session) && typeof event.session.id === 'string' &&
        (event.session.title === undefined || typeof event.session.title === 'string') &&
        (event.session.parentId === undefined || typeof event.session.parentId === 'string')
    case 'message.upserted': {
      const message = event.message
      return isRecord(message) && typeof message.id === 'string' && typeof message.sessionId === 'string' &&
        (message.role === 'user' || message.role === 'assistant' || message.role === 'system') &&
        typeof message.content === 'string' && typeof message.timestamp === 'string' && Array.isArray(message.parts) && message.parts.every(isPart)
    }
    case 'message.removed':
      return typeof event.messageId === 'string'
    case 'part.upserted':
      return typeof event.messageId === 'string' && isPart(event.part)
    case 'part.delta':
      return typeof event.messageId === 'string' && typeof event.partId === 'string' && typeof event.delta === 'string' && (event.field === 'text' || event.field === 'reasoning')
    case 'part.removed':
      return typeof event.messageId === 'string' && typeof event.partId === 'string'
    case 'permission.asked':
      return isRecord(event.permission) && typeof event.permission.id === 'string' && typeof event.permission.sessionId === 'string' && typeof event.permission.title === 'string' && event.permission.state === 'pending'
    case 'permission.resolved':
      return typeof event.sessionId === 'string' && typeof event.permissionId === 'string'
    case 'workspace.touched':
    case 'knowledge.proposals_changed':
      return true
    default:
      return false
  }
}

export function parseArcheEvent(data: string): ArcheEvent | null {
  try {
    const event: unknown = JSON.parse(data)
    return isArcheEvent(event) ? event : null
  } catch {
    return null
  }
}

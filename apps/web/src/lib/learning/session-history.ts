import { extractTextContent, transformParts } from '@/lib/opencode/transform'

export type SessionHistoryRequest = {
  includeMessages?: boolean
  limit?: number
  maxMessagesPerSession?: number
  query?: string
  sessionIds?: string[]
}

export function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
}

export function getSessionTitle(session: unknown): string {
  if (!isRecord(session)) return 'Untitled'
  return typeof session.title === 'string' && session.title.trim() ? session.title : 'Untitled'
}

export function getSessionId(session: unknown): string | null {
  if (!isRecord(session)) return null
  return typeof session.id === 'string' ? session.id : null
}

export function getMessageText(message: unknown): string {
  if (!isRecord(message) || !Array.isArray(message.parts)) return ''
  return extractTextContent(transformParts(message.parts))
}

export function getMessageRole(message: unknown): string {
  if (!isRecord(message) || !isRecord(message.info)) return 'unknown'
  return typeof message.info.role === 'string' ? message.info.role : 'unknown'
}

export function clampSessionHistoryBounds(body: SessionHistoryRequest | null): {
  limit: number
  maxMessages: number
} {
  return {
    limit: Math.min(Math.max(Math.trunc(body?.limit ?? 20), 1), 100),
    maxMessages: Math.min(Math.max(Math.trunc(body?.maxMessagesPerSession ?? 20), 1), 100),
  }
}

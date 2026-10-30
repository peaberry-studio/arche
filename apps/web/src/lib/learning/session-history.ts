import type { WorkspaceMessage } from '@/types/workspace-runtime'

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

export function getMessageText(message: WorkspaceMessage): string {
  return message.parts
    .filter((part) => part.type === 'text')
    .map((part) => part.text)
    .join('\n')
}

export function getMessageRole(message: WorkspaceMessage): string {
  return message.role
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

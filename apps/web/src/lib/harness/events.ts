import type { HarnessError } from '@/lib/harness/errors'
import type { MessagePart, WorkspaceMessage, WorkspaceSession } from '@/types/workspace-runtime'

export type ArchePermission = {
  id: string
  sessionId: string
  messageId?: string
  callId?: string
  title: string
  permissionType?: string
  pattern?: string
  metadata?: Record<string, unknown>
  state: 'pending'
}

export type ArcheToolUpdate = {
  id: string
  name?: string
  status?: 'pending' | 'running' | 'completed' | 'error'
  input?: Record<string, unknown>
  rawInput?: string
  inputDelta?: string
  output?: string
  error?: string
  metadata?: Record<string, unknown> | null
}

export type ArcheEvent = { v: 1; at?: number } & (
  | { type: 'session.upserted'; session: Pick<WorkspaceSession, 'id'> & Partial<Pick<WorkspaceSession, 'title' | 'parentId'>>; replace?: boolean }
  | { type: 'session.removed'; sessionId: string }
  | { type: 'session.status'; sessionId: string; status: 'idle' | 'busy' }
  | { type: 'session.error'; sessionId: string; message?: string }
  | { type: 'message.upserted'; mode?: undefined; message: WorkspaceMessage }
  | { type: 'message.upserted'; mode: 'patch'; sessionId: string; messageId: string; patch: Partial<Pick<WorkspaceMessage, 'completedAt' | 'statusInfo'>> & { error?: HarnessError }; parts?: MessagePart[]; removeParts?: string[]; reset?: boolean }
  | { type: 'message.upserted'; mode: 'commit'; sessionId: string; messageId: string; timestamp: string; timestampRaw: number }
  | { type: 'message.removed'; messageId: string }
  | { type: 'part.upserted'; mode?: undefined; sessionId?: string; messageId: string; part: MessagePart; replace?: boolean }
  | { type: 'part.upserted'; mode: 'tool-patch'; sessionId: string; messageId: string; update: ArcheToolUpdate; attachments?: MessagePart[] }
  | { type: 'part.delta'; sessionId?: string; messageId: string; partId: string; field: 'text' | 'reasoning'; delta: string }
  | { type: 'part.removed'; sessionId?: string; messageId: string; partId: string }
  | { type: 'permission.asked'; permission: ArchePermission }
  | { type: 'permission.resolved'; sessionId: string; permissionId: string }
  | { type: 'workspace.touched' }
  | { type: 'knowledge.proposals_changed' }
)

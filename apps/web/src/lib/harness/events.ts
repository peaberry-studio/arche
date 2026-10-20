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

export type ArcheEvent = { v: 1 } & (
  | { type: 'session.upserted'; session: Pick<WorkspaceSession, 'id'> & Partial<Pick<WorkspaceSession, 'title' | 'parentId'>> }
  | { type: 'session.removed'; sessionId: string }
  | { type: 'session.status'; sessionId: string; status: 'idle' | 'busy' }
  | { type: 'session.error'; sessionId: string; message?: string }
  | { type: 'message.upserted'; message: WorkspaceMessage }
  | { type: 'message.removed'; messageId: string }
  | { type: 'part.upserted'; sessionId?: string; messageId: string; part: MessagePart }
  | { type: 'part.delta'; sessionId?: string; messageId: string; partId: string; field: 'text' | 'reasoning'; delta: string }
  | { type: 'part.removed'; sessionId?: string; messageId: string; partId: string }
  | { type: 'permission.asked'; permission: ArchePermission }
  | { type: 'permission.resolved'; sessionId: string; permissionId: string }
  | { type: 'workspace.touched' }
  | { type: 'knowledge.proposals_changed' }
)

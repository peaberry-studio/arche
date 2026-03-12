import type {
  MessagePart,
  MessageRole,
  MessageStatusInfo,
} from '@/lib/opencode/types'

export type WorkspaceMessageRuntimeState = {
  pending: boolean
  statusInfo?: MessageStatusInfo
}

type DeriveWorkspaceMessageStateInput = {
  role: MessageRole
  completedAt?: number
  parts: MessagePart[]
  sessionStatus?: 'busy' | 'idle' | 'unknown'
}

export function deriveWorkspaceMessageRuntimeState({
  role,
  completedAt,
  parts,
  sessionStatus = 'unknown',
}: DeriveWorkspaceMessageStateInput): WorkspaceMessageRuntimeState {
  if (role !== 'assistant') return { pending: false }

  const lastPart = parts[parts.length - 1]
  if (!lastPart) {
    if (typeof completedAt === 'number' && completedAt > 0) {
      return { pending: false, statusInfo: { status: 'error', detail: 'stream_incomplete' } }
    }

    if (sessionStatus === 'idle') {
      return { pending: false, statusInfo: { status: 'error', detail: 'stream_incomplete' } }
    }
    return { pending: true, statusInfo: { status: 'thinking' } }
  }

  if (lastPart.type === 'tool') {
    if (lastPart.state.status === 'pending' || lastPart.state.status === 'running') {
      return {
        pending: true,
        statusInfo: {
          status: 'tool-calling',
          toolName: lastPart.name,
          detail: lastPart.state.status === 'running' ? lastPart.state.title : undefined,
        },
      }
    }

    if (lastPart.state.status === 'error') {
      return {
        pending: false,
        statusInfo: {
          status: 'error',
          toolName: lastPart.name,
          detail: lastPart.state.error,
        },
      }
    }
  }

  if (lastPart.type === 'retry') {
    return { pending: true, statusInfo: { status: 'thinking', detail: lastPart.error } }
  }

  if (typeof completedAt === 'number' && completedAt > 0) {
    return { pending: false }
  }

  return { pending: false }
}

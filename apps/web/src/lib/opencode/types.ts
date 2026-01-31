/**
 * Types for OpenCode integration.
 * These extend/adapt the SDK types for our UI needs.
 */

// Re-export SDK types we use directly
export type {
  Session,
  Message,
  Part,
  FileNode,
  Provider,
  Agent,
  FileDiff
} from '@opencode-ai/sdk'

/**
 * Simplified file node for the file tree panel.
 */
export type WorkspaceFileNode = {
  id: string
  name: string
  path: string
  type: 'file' | 'directory'
  children?: WorkspaceFileNode[]
}

/**
 * File content with metadata.
 */
export type WorkspaceFileContent = {
  path: string
  content: string
  type: 'raw' | 'patch'
}

/**
 * Session status in UI terms.
 */
export type SessionStatus = 'active' | 'idle' | 'busy' | 'error'

/**
 * Workspace session adapted for UI.
 */
export type WorkspaceSession = {
  id: string
  title: string
  status: SessionStatus
  updatedAt: string
  parentId?: string
  share?: {
    url: string
    version: number
  }
}

/**
 * Message role for UI display.
 */
export type MessageRole = 'user' | 'assistant' | 'system'

/**
 * Chat message adapted for UI.
 */
export type WorkspaceMessage = {
  id: string
  sessionId: string
  role: MessageRole
  content: string
  timestamp: string
  parts: MessagePart[]
  pending?: boolean
  /** Status info for streaming messages */
  statusInfo?: MessageStatusInfo
}

/**
 * Message part types we handle in UI.
 */
export type MessagePart = 
  | { type: 'text'; text: string }
  | { type: 'tool-invocation'; toolName: string; args: Record<string, unknown>; result?: unknown }
  | { type: 'file'; path: string }
  | { type: 'image'; url: string }

/**
 * Status types for streaming message state.
 */
export type MessageStatus = 
  | 'idle'
  | 'thinking'
  | 'reasoning' 
  | 'tool-calling'
  | 'writing'
  | 'complete'
  | 'error'

/**
 * Extended status info for display during streaming.
 */
export type MessageStatusInfo = {
  status: MessageStatus
  toolName?: string  // Name of tool being called
  detail?: string    // Additional detail (e.g., file being written)
}

/**
 * Available model for selection.
 */
export type AvailableModel = {
  providerId: string
  providerName: string
  modelId: string
  modelName: string
  isDefault: boolean
}

/**
 * Workspace connection state.
 */
export type WorkspaceConnectionState = 
  | { status: 'connecting' }
  | { status: 'connected'; version: string }
  | { status: 'disconnected'; reason?: string }
  | { status: 'error'; error: string }

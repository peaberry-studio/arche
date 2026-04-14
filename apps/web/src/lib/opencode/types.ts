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
  updatedAtRaw?: number
  parentId?: string
  autopilot?: {
    runId: string
    taskId: string
    taskName: string
    trigger: 'on_create' | 'schedule' | 'manual'
    hasUnseenResult: boolean
  }
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
  agentId?: string
  model?: {
    providerId: string
    modelId: string
  }
  content: string
  timestamp: string
  /** Raw timestamp in milliseconds for comparison (e.g., grouping by minute) */
  timestampRaw?: number
  parts: MessagePart[]
  pending?: boolean
  /** Status info for streaming messages */
  statusInfo?: MessageStatusInfo
}

/**
 * Tool invocation state matching OpenCode's ToolState.
 */
export type ToolState = 
  | { status: 'pending'; input: Record<string, unknown> }
  | { status: 'running'; input: Record<string, unknown>; title?: string }
  | { status: 'completed'; input: Record<string, unknown>; output: string; title: string }
  | { status: 'error'; input: Record<string, unknown>; error: string }

/**
 * Message part types we handle in UI.
 * Maps to OpenCode's Part types with UI-friendly structure.
 */
export type MessagePart = 
  // Content parts
  | { type: 'text'; id?: string; text: string }
  | { type: 'reasoning'; id?: string; text: string }
  | { type: 'file'; id?: string; path: string; filename?: string; mime?: string; url?: string }
  | { type: 'image'; id?: string; url: string }
  
  // Tool parts
  | { type: 'tool'; id: string; name: string; state: ToolState }
  
  // Step parts (for showing progress)
  | { type: 'step-start'; id: string; snapshot?: string }
  | { type: 'step-finish'; id: string; reason: string; cost: number; tokens: { input: number; output: number } }
  
  // Code/diff parts
  | { type: 'patch'; id: string; files: string[] }
  
  // Agent parts
  | { type: 'agent'; id: string; name: string }
  | { type: 'subtask'; id: string; prompt: string; description: string; agent: string }
  
  // Error/retry parts
  | { type: 'retry'; id: string; attempt: number; error: string }
  
  // Fallback for unknown types - renders raw data for debugging
  | { type: 'unknown'; originalType: string; data: Record<string, unknown> }

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

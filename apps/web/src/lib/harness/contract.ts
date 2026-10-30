import type { ArcheEvent } from '@/lib/harness/events'
import type { HarnessError, HarnessResult } from '@/lib/harness/errors'
import type {
  AvailableModel,
  PermissionResponse,
  WorkspaceMessage,
  WorkspaceSession,
} from '@/types/workspace-runtime'

export type HarnessSession = WorkspaceSession & { createdAtRaw?: number }

export type HarnessMessage = WorkspaceMessage & { error?: HarnessError }

export type HarnessModel = AvailableModel & { cost?: { input: number; output: number } }

export type HarnessAgent = {
  id: string
  name: string
  description?: string
  model?: { providerId: string; modelId: string }
}

export type HarnessSessionStatus =
  | { type: 'idle' }
  | { type: 'busy' }
  | { type: 'retry'; attempt?: number; message?: string; next?: number; terminalError?: string }
  | { type: 'unknown' }

export type HarnessPermission = {
  id: string
  sessionId: string
  messageId?: string
  callId?: string
  title: string
  kind?: string
  pattern?: string
  metadata?: Record<string, unknown>
  state: 'pending'
}

export type HarnessPromptPart =
  | { type: 'text'; text: string }
  | { type: 'file'; mime: string; filename?: string; url: string }

export type HarnessPrompt = {
  sessionId: string
  messageId?: string
  parts: HarnessPromptPart[]
  agent?: string
  model?: { providerId: string; modelId: string }
  noReply?: boolean
}

export type HarnessHealthOptions = {
  timeoutMs?: number
  signal?: AbortSignal
  password?: string
  baseUrl?: string
}

export type HarnessOperationOptions = {
  signal?: AbortSignal
}

export type HarnessProviderAccessInput = {
  userId: string
  force?: boolean
  ignoreActiveRunId?: string
  disposeInstance?: boolean
  connection?: { baseUrl: string; authHeader: string }
}

export type HarnessSessionDiff = {
  path: string
  status: 'modified' | 'added' | 'deleted'
  additions: number
  deletions: number
  diff: string
}

export type HarnessRuntime = {
  kind: string
  slug: string
  health(options?: HarnessHealthOptions): Promise<HarnessResult<{ version?: string }>>
  createSession(input?: { title?: string; parentId?: string }): Promise<HarnessResult<HarnessSession>>
  getSession(sessionId: string): Promise<HarnessResult<HarnessSession>>
  listSessions(options?: { limit?: number; rootsOnly?: boolean; start?: number }): Promise<HarnessResult<HarnessSession[]>>
  listChildren(sessionId: string): Promise<HarnessResult<HarnessSession[]>>
  updateSession(sessionId: string, title: string): Promise<HarnessResult<HarnessSession>>
  deleteSession(sessionId: string): Promise<HarnessResult<void>>
  sessionStatus(options?: HarnessOperationOptions): Promise<HarnessResult<Record<string, HarnessSessionStatus>>>
  listMessages(sessionId: string, options?: HarnessOperationOptions): Promise<HarnessResult<HarnessMessage[]>>
  prompt(input: HarnessPrompt, options?: HarnessOperationOptions): Promise<HarnessResult<void>>
  sendMessage(input: HarnessPrompt): Promise<HarnessResult<HarnessMessage>>
  abortSession(sessionId: string): Promise<HarnessResult<void>>
  listPermissions(): Promise<HarnessResult<HarnessPermission[]>>
  replyPermission(input: { sessionId: string; permissionId: string; response: PermissionResponse }, options?: HarnessOperationOptions): Promise<HarnessResult<void>>
  listModels(): Promise<HarnessResult<HarnessModel[]>>
  listAgents(): Promise<HarnessResult<HarnessAgent[]>>
  listConnectorKeys(): Promise<HarnessResult<string[]>>
  listConnectorStatus(): Promise<HarnessResult<Record<string, boolean>>>
  sessionDiff(sessionId: string): Promise<HarnessResult<HarnessSessionDiff[]>>
  syncProviderAccess(input: HarnessProviderAccessInput): Promise<HarnessResult<void>>
  subscribeEvents(signal: AbortSignal): Promise<HarnessResult<AsyncIterable<ArcheEvent>>>
}

// Read-only access to an OpenCode 1 workspace, kept only to archive its
// conversations before the workspace first starts on the current runtime.
export type LegacySessionReader = Pick<HarnessRuntime,
  'slug' | 'health' | 'getSession' | 'listSessions' | 'listChildren' | 'listMessages' | 'sessionStatus'>

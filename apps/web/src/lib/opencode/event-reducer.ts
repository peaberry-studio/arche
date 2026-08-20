import { isWorkspaceTouchEvent, type OpenCodeEvent } from '@/lib/opencode/opencode-event'
import {
  getPermissionEventPayload,
  normalizePendingPermission,
  type WorkspacePermission,
} from '@/lib/opencode/permission'
import { extractTextContent, transformParts } from '@/lib/opencode/transform'
import type { MessagePart, MessageRole, WorkspaceMessage, WorkspaceSession } from '@/lib/opencode/types'
import { isRecord } from '@/lib/records'

export type SessionRuntimeStatus = 'idle' | 'busy'

export type ChatStore = {
  /** sessionId → messages for that session */
  messages: Record<string, WorkspaceMessage[]>
  /** sessionId → runtime status */
  sessionStatus: Record<string, SessionRuntimeStatus>
  /** sessionId → pending permissions */
  permissions: Record<string, WorkspacePermission[]>
  /** Flat session list (parentId used to resolve child permission visibility) */
  sessions: WorkspaceSession[]
  /** sessionId → ids of optimistic user messages not yet confirmed server-side */
  optimisticUserIds: Record<string, string[]>
}

export type ReduceResult = {
  store: ChatStore
  workspaceTouched: boolean
}

export function createEmptyChatStore(): ChatStore {
  return {
    messages: {},
    sessionStatus: {},
    permissions: {},
    sessions: [],
    optimisticUserIds: {},
  }
}

export function isSending(store: ChatStore, sessionId: string): boolean {
  return (store.sessionStatus[sessionId] ?? 'idle') === 'busy'
}

function getString(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value.trim() : undefined
}

function getNumber(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined
}

function normalizeMessageRole(role: unknown): MessageRole | null {
  return role === 'user' || role === 'assistant' || role === 'system' ? role : null
}

function extractUserTextContent(parts: MessagePart[]): string {
  const firstText = parts.find((part) => part.type === 'text')
  return firstText ? firstText.text : ''
}

function messagesForSession(store: ChatStore, sessionId: string): WorkspaceMessage[] {
  return store.messages[sessionId] ?? []
}

function compareMessages(a: WorkspaceMessage, b: WorkspaceMessage): number {
  const leftTime = a.timestampRaw ?? 0
  const rightTime = b.timestampRaw ?? 0
  if (leftTime !== rightTime) return leftTime - rightTime
  return a.id.localeCompare(b.id)
}

function withMessages(
  store: ChatStore,
  sessionId: string,
  messages: WorkspaceMessage[],
): ChatStore {
  const next = { ...store, messages: { ...store.messages } }
  const sorted = [...messages].sort(compareMessages)
  if (sorted.length === 0) {
    delete next.messages[sessionId]
  } else {
    next.messages[sessionId] = sorted
  }
  return next
}

function toWorkspaceMessage(info: Record<string, unknown>): WorkspaceMessage | null {
  const id = getString(info.id)
  const role = normalizeMessageRole(info.role)
  const sessionId = getString(info.sessionID) ?? getString(info.sessionId)
  if (!id || !role || !sessionId) return null

  const rawParts = Array.isArray(info.parts) ? info.parts : []
  const parts = transformParts(rawParts)
  const time = isRecord(info.time) ? info.time : {}
  const timestampRaw = getNumber(time.created)
  const completedAt = getNumber(time.completed)
  const infoModel = isRecord(info.model) ? info.model : {}
  const rawProviderId = getString(info.providerID) ?? getString(infoModel.providerID)
  const modelId = getString(info.modelID) ?? getString(infoModel.modelID)
  const agentId = getString(info.agent)

  return {
    id,
    sessionId,
    role,
    ...(agentId && { agentId }),
    ...(rawProviderId && modelId ? { model: { providerId: rawProviderId, modelId } } : {}),
    content:
      role === 'user' ? extractUserTextContent(parts) : extractTextContent(parts),
    timestamp: timestampRaw ? String(timestampRaw) : '',
    ...(typeof timestampRaw === 'number' && { timestampRaw }),
    ...(typeof completedAt === 'number' && completedAt > 0 && { completedAt }),
    parts,
  }
}

function upsertMessageInSession(
  store: ChatStore,
  sessionId: string,
  message: WorkspaceMessage,
): ChatStore {
  const messages = messagesForSession(store, sessionId)
  const existingIndex = messages.findIndex((candidate) => candidate.id === message.id)
  const nextMessages =
    existingIndex >= 0
      ? messages.map((candidate, index) => (index === existingIndex ? message : candidate))
      : [...messages, message]
  return withMessages(store, sessionId, nextMessages)
}

function upsertPartInMessage(
  store: ChatStore,
  sessionId: string,
  messageId: string,
  part: MessagePart,
): ChatStore {
  const messages = messagesForSession(store, sessionId)
  return withMessages(store, sessionId,
    messages.map((message) => {
      if (message.id !== messageId) return message
      const nextParts = [...message.parts]
      const partId = 'id' in part ? part.id : undefined
      const targetIndex = partId
        ? message.parts.findIndex((candidate) => 'id' in candidate && candidate.id === partId)
        : -1
      if (targetIndex >= 0) {
        nextParts[targetIndex] = part
      } else {
        nextParts.push(part)
      }
      return {
        ...message,
        parts: nextParts,
        content: message.role === 'user'
          ? extractUserTextContent(nextParts)
          : extractTextContent(nextParts),
      }
    }),
  )
}

function appendDeltaToPart(
  store: ChatStore,
  sessionId: string,
  messageId: string,
  partId: string,
  field: string,
  delta: string,
): ChatStore {
  const messages = messagesForSession(store, sessionId)
  return withMessages(store, sessionId,
    messages.map((message) => {
      if (message.id !== messageId) return message
      let changed = false
      const nextParts = message.parts.map((part) => {
        if (!('id' in part && part.id === partId)) return part
        if (part.type !== 'text' && part.type !== 'reasoning') return part
        if (field !== 'text' && field !== 'reasoning') return part
        changed = true
        return { ...part, text: `${part.text}${delta}` }
      })
      if (!changed) return message
      return {
        ...message,
        parts: nextParts,
        content: message.role === 'user'
          ? extractUserTextContent(nextParts)
          : extractTextContent(nextParts),
      }
    }),
  )
}

function removeMessageById(store: ChatStore, messageId: string): ChatStore {
  for (const [sessionId, messages] of Object.entries(store.messages)) {
    if (messages.some((candidate) => candidate.id === messageId)) {
      return withMessages(store, sessionId, messages.filter((candidate) => candidate.id !== messageId))
    }
  }
  return store
}

function withOptimisticRemoved(store: ChatStore, sessionId: string, messageId: string): ChatStore {
  const optimisticIds = store.optimisticUserIds[sessionId] ?? []
  if (!optimisticIds.includes(messageId)) return store
  const next = { ...store, optimisticUserIds: { ...store.optimisticUserIds } }
  const remaining = optimisticIds.filter((id) => id !== messageId)
  if (remaining.length === 0) {
    delete next.optimisticUserIds[sessionId]
  } else {
    next.optimisticUserIds[sessionId] = remaining
  }
  return next
}

function addOptimisticUser(store: ChatStore, sessionId: string, messageId: string): ChatStore {
  const optimisticIds = store.optimisticUserIds[sessionId] ?? []
  if (optimisticIds.includes(messageId)) return store
  const next = { ...store, optimisticUserIds: { ...store.optimisticUserIds } }
  next.optimisticUserIds[sessionId] = [...optimisticIds, messageId]
  return next
}

function upsertMessageFromEvent(
  store: ChatStore,
  info: Record<string, unknown>,
  optimistic: boolean,
): ChatStore {
  const message = toWorkspaceMessage(info)
  if (!message) return store

  let next = upsertMessageInSession(store, message.sessionId, message)

  if (message.role === 'user') {
    if (optimistic) {
      next = addOptimisticUser(next, message.sessionId, message.id)
      return next
    }

    // A confirmed server user message clears optimistic user messages in the
    // same session that share its id or its text.
    const optimisticIds = next.optimisticUserIds[message.sessionId] ?? []
    for (const optimisticId of optimisticIds) {
      if (optimisticId === message.id) continue
      const optimisticMessage = messagesForSession(next, message.sessionId)
        .find((candidate) => candidate.id === optimisticId)
      if (!optimisticMessage) continue
      if (optimisticMessage.content === message.content) {
        next = removeOptimisticUserMessage(next, message.sessionId, optimisticId)
      }
    }
  }

  return next
}

function removeOptimisticUserMessage(
  store: ChatStore,
  sessionId: string,
  messageId: string,
): ChatStore {
  let next = withOptimisticRemoved(store, sessionId, messageId)
  const messages = messagesForSession(store, sessionId)
  if (messages.some((candidate) => candidate.id === messageId)) {
    next = withMessages(next, sessionId, messages.filter((candidate) => candidate.id !== messageId))
  }
  return next
}

function setStatus(store: ChatStore, sessionId: string, status: SessionRuntimeStatus): ChatStore {
  const next = { ...store, sessionStatus: { ...store.sessionStatus } }
  next.sessionStatus[sessionId] = status
  return next
}

function withPermissions(
  store: ChatStore,
  sessionId: string,
  permissions: WorkspacePermission[],
): ChatStore {
  const next = { ...store, permissions: { ...store.permissions } }
  if (permissions.length === 0) {
    delete next.permissions[sessionId]
  } else {
    next.permissions[sessionId] = permissions
  }
  return next
}

function upsertPermission(store: ChatStore, permission: WorkspacePermission): ChatStore {
  const sessionId = permission.sessionId
  const permissions = store.permissions[sessionId] ?? []
  const existingIndex = permissions.findIndex((candidate) => candidate.id === permission.id)
  const nextPermissions =
    existingIndex >= 0
      ? permissions.map((candidate, index) => (index === existingIndex ? permission : candidate))
      : [...permissions, permission]
  return withPermissions(store, sessionId, nextPermissions)
}

function removePermission(store: ChatStore, sessionId: string, permissionId: string): ChatStore {
  const permissions = store.permissions[sessionId] ?? []
  return withPermissions(store, sessionId, permissions.filter((permission) => permission.id !== permissionId))
}

function upsertSession(store: ChatStore, info: Record<string, unknown>): ChatStore {
  const id = getString(info.id)
  if (!id) return store
  const existing = store.sessions.find((session) => session.id === id)
  const parentId = getString(info.parentID) ?? getString(info.parentId)
  const nextSession: WorkspaceSession = {
    id,
    title: existing?.title ?? getString(info.title) ?? 'Untitled',
    status: existing?.status ?? 'idle',
    updatedAt: existing?.updatedAt ?? '',
    ...(existing?.updatedAtRaw !== undefined && { updatedAtRaw: existing.updatedAtRaw }),
    ...(parentId ? { parentId } : existing?.parentId ? { parentId: existing.parentId } : {}),
    ...(existing?.flow && { flow: existing.flow }),
    ...(existing?.share && { share: existing.share }),
  }
  const existingIndex = store.sessions.findIndex((session) => session.id === id)
  const nextSessions =
    existingIndex >= 0
      ? store.sessions.map((session, index) => (index === existingIndex ? nextSession : session))
      : [...store.sessions, nextSession]
  return { ...store, sessions: nextSessions }
}

function markLastAssistantError(
  store: ChatStore,
  sessionId: string,
  message: string | undefined,
): ChatStore {
  const messages = messagesForSession(store, sessionId)
  let mutated = false
  const reordered = [...messages].reverse().map((candidate) => {
    if (mutated || candidate.role !== 'assistant') return candidate
    mutated = true
    return { ...candidate, statusInfo: { status: 'error' as const, detail: message ?? 'session_error' } }
  }).reverse()
  return mutated ? withMessages(store, sessionId, reordered) : store
}

function applyMessageUpdated(store: ChatStore, properties: Record<string, unknown>): ChatStore {
  const info = isRecord(properties.info) ? properties.info : null
  if (!info) return store
  return upsertMessageFromEvent(store, info, false)
}

function applyMessagePartUpdated(store: ChatStore, properties: Record<string, unknown>): ChatStore {
  const part = isRecord(properties.part) ? properties.part : null
  if (!part) return store

  const partType = getString(part.type)
  if (partType === 'patch' || partType === 'step-start' || partType === 'step-finish') {
    return store
  }

  const messageId = getString(part.messageID)
  if (!messageId) return store

  const transformed = transformMessagePart(part)
  if (!transformed) return store

  const { sessionId, message } = locateMessageGlobal(store, messageId)
  if (!message) return store
  return upsertPartInMessage(store, sessionId, messageId, transformed)
}

function locateMessageGlobal(
  store: ChatStore,
  messageId: string,
): { sessionId: string; message: WorkspaceMessage | null } {
  for (const [sessionId, messages] of Object.entries(store.messages)) {
    const message = messages.find((candidate) => candidate.id === messageId)
    if (message) return { sessionId, message }
  }
  return { sessionId: '', message: null }
}

function transformMessagePart(part: Record<string, unknown>): MessagePart | null {
  const transformed = transformParts([part])
  return transformed[0] ?? null
}

function applyMessagePartDelta(store: ChatStore, properties: Record<string, unknown>): ChatStore {
  const messageId = getString(properties.messageID)
  const partId = getString(properties.partID) ?? getString(properties.id)
  const field = getString(properties.field)
  // Deltas are raw content: a whitespace-only chunk (e.g. the space between
  // two words) is valid and must not be trimmed away.
  const delta = typeof properties.delta === 'string' ? properties.delta : undefined
  if (!messageId || !partId || !field || delta === undefined) return store

  const { sessionId, message } = locateMessageGlobal(store, messageId)
  if (!message) return store

  // No-op unless the part already exists; the full part.updated carries text.
  const partExists = message.parts.some((part) => 'id' in part && part.id === partId)
  if (!partExists) return store

  return appendDeltaToPart(store, sessionId, messageId, partId, field, delta)
}

function applyMessagePartRemoved(store: ChatStore, properties: Record<string, unknown>): ChatStore {
  const messageId = getString(properties.messageID)
  const partId = getString(properties.partID) ?? getString(properties.id)
  if (!messageId || !partId) return store
  const { sessionId, message } = locateMessageGlobal(store, messageId)
  if (!message) return store
  const nextParts = message.parts.filter((part) => 'id' in part && part.id !== partId)
  return withMessages(store, sessionId,
    messagesForSession(store, sessionId).map((candidate) => {
      if (candidate.id !== messageId) return candidate
      return {
        ...candidate,
        parts: nextParts,
        content: candidate.role === 'user'
          ? extractUserTextContent(nextParts)
          : extractTextContent(nextParts),
      }
    }),
  )
}

function applyPermissionAsked(store: ChatStore, properties: Record<string, unknown>): ChatStore {
  const permission = normalizePendingPermission(getPermissionEventPayload({ type: '', properties }))
  if (!permission) return store
  return upsertPermission(store, permission)
}

function applyPermissionReplied(store: ChatStore, properties: Record<string, unknown>): ChatStore {
  const sessionId = getString(properties.sessionID) ?? getString(properties.sessionId)
  const permissionPayload = getPermissionEventPayload({ type: '', properties })
  const permissionId =
    getString(properties.requestID) ??
    getString(permissionPayload?.id) ??
    getString(properties.permissionID) ??
    getString(properties.permissionId)
  if (!sessionId || !permissionId) return store
  return removePermission(store, sessionId, permissionId)
}

/**
 * Apply a single OpenCode event to the store. Pure: no I/O, no time.
 */
export function reduceOpenCodeEvent(
  store: ChatStore,
  event: OpenCodeEvent | Record<string, unknown>,
): ReduceResult {
  const eventType = typeof event.type === 'string' ? event.type : ''
  const properties = isRecord(event.properties) ? event.properties : {}

  switch (eventType) {
    case 'session.status': {
      const sessionId = getString(properties.sessionID)
      const status = isRecord(properties.status) ? properties.status : {}
      if (!sessionId) return { store, workspaceTouched: false }
      const next = status.type === 'idle' ? 'idle' : 'busy'
      return { store: setStatus(store, sessionId, next), workspaceTouched: false }
    }

    case 'session.idle': {
      const sessionId = getString(properties.sessionID)
      if (!sessionId) return { store, workspaceTouched: false }
      return { store: setStatus(store, sessionId, 'idle'), workspaceTouched: false }
    }

    case 'session.error': {
      const sessionId = getString(properties.sessionID)
      const error = isRecord(properties.error) ? properties.error : {}
      const errorData = isRecord(error.data) ? error.data : {}
      const message =
        getString(errorData.message) ?? getString(error.message) ?? getString(properties.message)
      if (!sessionId) return { store, workspaceTouched: false }
      return {
        store: markLastAssistantError(store, sessionId, message),
        workspaceTouched: false,
      }
    }

    case 'message.updated':
      return { store: applyMessageUpdated(store, properties), workspaceTouched: false }

    case 'message.removed': {
      const messageId = getString(properties.messageID) ?? getString(properties.id)
      return {
        store: messageId ? removeMessageById(store, messageId) : store,
        workspaceTouched: false,
      }
    }

    case 'message.part.updated':
      return { store: applyMessagePartUpdated(store, properties), workspaceTouched: false }

    case 'message.part.delta':
      return { store: applyMessagePartDelta(store, properties), workspaceTouched: false }

    case 'message.part.removed':
      return { store: applyMessagePartRemoved(store, properties), workspaceTouched: false }

    case 'permission.asked':
    case 'permission.updated':
    case 'permission.v2.asked':
      return { store: applyPermissionAsked(store, properties), workspaceTouched: false }

    case 'permission.replied':
    case 'permission.v2.replied':
      return { store: applyPermissionReplied(store, properties), workspaceTouched: false }

    case 'session.created':
    case 'session.updated': {
      const info = isRecord(properties.info)
        ? properties.info
        : isRecord(properties.session)
          ? properties.session
          : {}
      return { store: upsertSession(store, info), workspaceTouched: false }
    }

    default:
      return { store, workspaceTouched: isWorkspaceTouchEvent(eventType) }
  }
}

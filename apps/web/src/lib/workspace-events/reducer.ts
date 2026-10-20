import type { ArcheEvent, ArchePermission } from '@/lib/harness/events'
import type { MessagePart, WorkspaceMessage, WorkspaceSession } from '@/types/workspace-runtime'

export type SessionRuntimeStatus = 'idle' | 'busy'
export type ChatStore = {
  messages: Record<string, WorkspaceMessage[]>
  sessionStatus: Record<string, SessionRuntimeStatus>
  permissions: Record<string, ArchePermission[]>
  sessions: WorkspaceSession[]
  pendingParts: Record<string, MessagePart[]>
}
export type ReduceResult = { store: ChatStore; workspaceTouched: boolean }

export function createEmptyChatStore(): ChatStore {
  return { messages: {}, sessionStatus: {}, permissions: {}, sessions: [], pendingParts: {} }
}

export function isSending(store: ChatStore, sessionId: string): boolean {
  return store.sessionStatus[sessionId] === 'busy'
}

export function overlaySessionRuntimeStatus(session: WorkspaceSession, runtime: SessionRuntimeStatus | undefined): WorkspaceSession {
  if (runtime === 'busy') return session.status === 'busy' ? session : { ...session, status: 'busy' }
  return session.status === 'error' || session.status === 'idle' ? session : { ...session, status: 'idle' }
}

function contentFor(role: WorkspaceMessage['role'], parts: MessagePart[]): string {
  if (role === 'user') return parts.find((part) => part.type === 'text')?.text ?? ''
  return parts.filter((part) => (part.type === 'text' || part.type === 'reasoning') && part.text.trim())
    .map((part) => part.type === 'text' || part.type === 'reasoning' ? part.text : '').join('\n')
}

function withMessages(store: ChatStore, sessionId: string, messages: WorkspaceMessage[]): ChatStore {
  const next = { ...store, messages: { ...store.messages } }
  const sorted = [...messages].sort((a, b) => {
    const difference = (a.timestampRaw ?? 0) - (b.timestampRaw ?? 0)
    return difference || (!a.timestampRaw && !b.timestampRaw ? 0 : a.id.localeCompare(b.id))
  })
  if (sorted.length) next.messages[sessionId] = sorted
  else delete next.messages[sessionId]
  return next
}

function withPendingParts(store: ChatStore, messageId: string, parts: MessagePart[]): ChatStore {
  const next = { ...store, pendingParts: { ...store.pendingParts } }
  if (parts.length) next.pendingParts[messageId] = parts
  else delete next.pendingParts[messageId]
  return next
}

function mergePart(existing: MessagePart, incoming: MessagePart): MessagePart {
  if ((existing.type === 'text' || existing.type === 'reasoning') && existing.type === incoming.type && (incoming.type === 'text' || incoming.type === 'reasoning')) {
    return { ...incoming, text: existing.text.length > incoming.text.length ? existing.text : incoming.text }
  }
  return incoming
}

function upsertPart(parts: MessagePart[], incoming: MessagePart): MessagePart[] {
  const id = 'id' in incoming ? incoming.id : undefined
  const index = id ? parts.findIndex((part) => 'id' in part && part.id === id) : -1
  return index < 0 ? [...parts, incoming] : parts.map((part, i) => i === index ? mergePart(part, incoming) : part)
}

function locateMessage(store: ChatStore, messageId: string): { sessionId: string; message: WorkspaceMessage } | undefined {
  for (const [sessionId, messages] of Object.entries(store.messages)) {
    const message = messages.find((candidate) => candidate.id === messageId)
    if (message) return { sessionId, message }
  }
}

function replaceParts(store: ChatStore, sessionId: string, messageId: string, parts: MessagePart[]): ChatStore {
  return withMessages(store, sessionId, (store.messages[sessionId] ?? []).map((message) => message.id === messageId
    ? { ...message, parts, content: contentFor(message.role, parts) } : message))
}

export function hydrateSessionIntoStore(store: ChatStore, sessionId: string, hydrated: WorkspaceMessage[]): ChatStore {
  const byId = new Map((store.messages[sessionId] ?? []).map((message) => [message.id, message]))
  for (const incoming of hydrated) {
    const live = byId.get(incoming.id)
    const richer = live && (live.parts.length > incoming.parts.length || (live.parts.length === incoming.parts.length && live.content.length > incoming.content.length))
    byId.set(incoming.id, richer ? { ...incoming, parts: live.parts, content: live.content } : incoming)
  }
  return withMessages(store, sessionId, [...byId.values()])
}

export function hydratePermissionsIntoStore(store: ChatStore, snapshot: Record<string, ArchePermission[]>, baseline: Record<string, ArchePermission[]> = {}): ChatStore {
  const baselineIds = new Set(Object.values(baseline).flat().map((permission) => permission.id))
  const live = Object.values(store.permissions).flat()
  const liveIds = new Set(live.map((permission) => permission.id))
  const removed = new Set([...baselineIds].filter((id) => !liveIds.has(id)))
  const permissions: Record<string, ArchePermission[]> = {}
  for (const permission of [...Object.values(snapshot).flat(), ...live.filter((permission) => !baselineIds.has(permission.id))]) {
    if (removed.has(permission.id)) continue
    const list = permissions[permission.sessionId] ?? []
    const index = list.findIndex((candidate) => candidate.id === permission.id)
    permissions[permission.sessionId] = index < 0 ? [...list, permission] : list.map((candidate, i) => i === index ? permission : candidate)
  }
  return { ...store, permissions }
}

export function reduceArcheEvent(store: ChatStore, event: ArcheEvent): ReduceResult {
  if (event.v !== 1) return { store, workspaceTouched: false }
  let next = store
  switch (event.type) {
    case 'session.status':
      next = { ...store, sessionStatus: { ...store.sessionStatus, [event.sessionId]: event.status } }
      break
    case 'session.error': {
      let marked = false
      const messages = [...(store.messages[event.sessionId] ?? [])].reverse().map((message) => {
        if (marked || message.role !== 'assistant') return message
        marked = true
        return { ...message, statusInfo: { status: 'error' as const, detail: event.message ?? 'session_error' } }
      }).reverse()
      if (marked) next = withMessages(store, event.sessionId, messages)
      break
    }
    case 'session.upserted': {
      const existing = store.sessions.find((session) => session.id === event.session.id)
      const session: WorkspaceSession = {
        id: event.session.id,
        title: existing?.title ?? event.session.title ?? 'Untitled',
        status: existing?.status ?? 'idle',
        updatedAt: existing?.updatedAt ?? '',
        ...(existing?.updatedAtRaw !== undefined && { updatedAtRaw: existing.updatedAtRaw }),
        ...((event.session.parentId ?? existing?.parentId) && { parentId: event.session.parentId ?? existing?.parentId }),
        ...(existing?.flow && { flow: existing.flow }),
        ...(existing?.share && { share: existing.share }),
      }
      next = { ...store, sessions: existing ? store.sessions.map((candidate) => candidate.id === session.id ? session : candidate) : [...store.sessions, session] }
      break
    }
    case 'session.removed': {
      const messages = { ...store.messages }
      const sessionStatus = { ...store.sessionStatus }
      const permissions = { ...store.permissions }
      const pendingParts = { ...store.pendingParts }
      for (const message of messages[event.sessionId] ?? []) delete pendingParts[message.id]
      delete messages[event.sessionId]
      delete sessionStatus[event.sessionId]
      delete permissions[event.sessionId]
      next = { ...store, messages, sessionStatus, permissions, pendingParts, sessions: store.sessions.filter((session) => session.id !== event.sessionId) }
      break
    }
    case 'message.upserted': {
      const incoming = event.message
      const messages = store.messages[incoming.sessionId] ?? []
      const existing = messages.find((message) => message.id === incoming.id)
      const parts = incoming.parts.length ? incoming.parts : existing?.parts ?? incoming.parts
      const message = existing ? { ...existing, ...incoming, parts, content: contentFor(incoming.role, parts), timestamp: incoming.timestamp || existing.timestamp } : incoming
      next = withMessages(store, incoming.sessionId, existing ? messages.map((candidate) => candidate.id === message.id ? message : candidate) : [...messages, message])
      const pending = next.pendingParts[message.id]
      if (pending?.length) {
        let merged = message.parts
        for (const part of pending) merged = upsertPart(merged, part)
        next = withPendingParts(replaceParts(next, message.sessionId, message.id, merged), message.id, [])
      }
      break
    }
    case 'message.removed': {
      const located = locateMessage(store, event.messageId)
      if (located) next = withMessages(store, located.sessionId, store.messages[located.sessionId].filter((message) => message.id !== event.messageId))
      next = withPendingParts(next, event.messageId, [])
      break
    }
    case 'part.upserted': {
      if (event.part.type === 'patch' || event.part.type === 'step-start' || event.part.type === 'step-finish') break
      const located = locateMessage(store, event.messageId)
      next = located ? replaceParts(store, located.sessionId, event.messageId, upsertPart(located.message.parts, event.part))
        : withPendingParts(store, event.messageId, upsertPart(store.pendingParts[event.messageId] ?? [], event.part))
      break
    }
    case 'part.delta': {
      const located = locateMessage(store, event.messageId)
      const parts = located?.message.parts ?? store.pendingParts[event.messageId] ?? []
      if (!parts.some((part) => 'id' in part && part.id === event.partId)) break
      const updated = parts.map((part) => 'id' in part && part.id === event.partId && (part.type === 'text' || part.type === 'reasoning')
        ? { ...part, text: `${part.text}${event.delta}` } : part)
      next = located ? replaceParts(store, located.sessionId, event.messageId, updated) : withPendingParts(store, event.messageId, updated)
      break
    }
    case 'part.removed': {
      const located = locateMessage(store, event.messageId)
      if (located) next = replaceParts(store, located.sessionId, event.messageId, located.message.parts.filter((part) => 'id' in part && part.id !== event.partId))
      break
    }
    case 'permission.asked': {
      const permission = event.permission
      const list = store.permissions[permission.sessionId] ?? []
      const exists = list.some((candidate) => candidate.id === permission.id)
      next = { ...store, permissions: { ...store.permissions, [permission.sessionId]: exists ? list.map((candidate) => candidate.id === permission.id ? permission : candidate) : [...list, permission] } }
      break
    }
    case 'permission.resolved': {
      const permissions = { ...store.permissions }
      const list = (permissions[event.sessionId] ?? []).filter((permission) => permission.id !== event.permissionId)
      if (list.length) permissions[event.sessionId] = list
      else delete permissions[event.sessionId]
      next = { ...store, permissions }
      break
    }
  }
  return { store: next, workspaceTouched: event.type === 'workspace.touched' }
}

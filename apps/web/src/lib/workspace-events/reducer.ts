import type { ArcheEvent, ArchePermission, ArcheToolUpdate } from '@/lib/harness/events'
import type { MessagePart, WorkspaceMessage, WorkspaceSession } from '@/types/workspace-runtime'

export type SessionRuntimeStatus = 'idle' | 'busy'
export type ChatStore = {
  messages: Record<string, WorkspaceMessage[]>
  sessionStatus: Record<string, SessionRuntimeStatus>
  permissions: Record<string, ArchePermission[]>
  sessions: WorkspaceSession[]
  pendingParts: Record<string, MessagePart[]>
  pendingUpdates?: Record<string, ArcheEvent[]>
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

function upsertPart(parts: MessagePart[], incoming: MessagePart, replace = false): MessagePart[] {
  const id = 'id' in incoming ? incoming.id : undefined
  const index = id ? parts.findIndex((part) => 'id' in part && part.id === id) : -1
  return index < 0 ? [...parts, incoming] : parts.map((part, i) => i === index ? replace ? incoming : mergePart(part, incoming) : part)
}

function patchTool(parts: MessagePart[], update: ArcheToolUpdate): MessagePart[] {
  const existing = parts.find((part) => part.type === 'tool' && part.id === update.id)
  const tool = existing?.type === 'tool' ? existing : undefined
  const name = update.name ?? tool?.name
  if (!name) return parts
  const previous = tool?.state
  const status = update.status ?? previous?.status ?? 'pending'
  const input = update.input ?? previous?.input ?? {}
  const metadata = update.metadata === null ? undefined : update.metadata ?? previous?.metadata
  const extra = metadata === undefined ? {} : { metadata }
  let state: Extract<MessagePart, { type: 'tool' }>['state']
  if (status === 'pending') {
    const rawInput = update.rawInput ?? `${previous?.status === 'pending' ? previous.rawInput ?? '' : ''}${update.inputDelta ?? ''}`
    state = { status, input, rawInput, ...extra }
  } else if (status === 'running') {
    const title = typeof metadata?.title === 'string' ? metadata.title : undefined
    state = { status, input, ...(title !== undefined && { title }), ...extra }
  } else if (status === 'completed') {
    const output = update.output ?? (previous?.status === 'completed' ? previous.output : undefined)
    if (output === undefined) return parts
    state = { status, input, output, title: typeof metadata?.title === 'string' ? metadata.title : name, ...extra }
  } else {
    const error = update.error ?? (previous?.status === 'error' ? previous.error : undefined)
    if (error === undefined) return parts
    state = { status, input, error, ...extra }
  }
  return upsertPart(parts, { type: 'tool', id: update.id, name, state })
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

function queueUpdate(store: ChatStore, messageId: string, event: ArcheEvent): ChatStore {
  return { ...store, pendingUpdates: { ...store.pendingUpdates, [messageId]: [...store.pendingUpdates?.[messageId] ?? [], event] } }
}

function applyPendingUpdates(store: ChatStore, messageId: string): ChatStore {
  const updates = store.pendingUpdates?.[messageId]
  if (!updates) return store
  const pendingUpdates = { ...store.pendingUpdates }
  delete pendingUpdates[messageId]
  return updates.reduce<ChatStore>((current, event) => reduceArcheEvent(current, event).store, { ...store, pendingUpdates })
}

export function hydrateSessionIntoStore(store: ChatStore, sessionId: string, hydrated: WorkspaceMessage[]): ChatStore {
  const byId = new Map((store.messages[sessionId] ?? []).map((message) => [message.id, message]))
  for (const incoming of hydrated) {
    const live = byId.get(incoming.id)
    const richer = live && (live.parts.length > incoming.parts.length || (live.parts.length === incoming.parts.length && live.content.length > incoming.content.length))
    const useLive = live?.completedAt !== undefined && (incoming.completedAt === undefined || live.completedAt > incoming.completedAt)
    const chosen = useLive ? live : richer && incoming.completedAt === undefined ? { ...incoming, parts: live.parts, content: live.content } : incoming
    const delivered = live?.role === 'user' && live.timestampRaw !== undefined && live.timestampRaw > (chosen.timestampRaw ?? 0)
    const merged = delivered ? { ...chosen, timestamp: live.timestamp, timestampRaw: live.timestampRaw } : chosen
    let parts = merged.parts
    if (merged.completedAt === undefined) {
      for (const part of store.pendingParts[incoming.id] ?? []) parts = upsertPart(parts, part)
    }
    byId.set(incoming.id, parts === merged.parts ? merged : { ...merged, parts, content: contentFor(merged.role, parts) })
  }
  let next = withMessages(store, sessionId, [...byId.values()])
  for (const incoming of hydrated) {
    if (next.pendingParts[incoming.id]) next = withPendingParts(next, incoming.id, [])
    next = applyPendingUpdates(next, incoming.id)
  }
  return next
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
  if ('messageId' in event && event.at !== undefined) {
    const message = locateMessage(store, event.messageId)?.message
    if (message?.completedAt !== undefined && event.at <= message.completedAt) return { store, workspaceTouched: false }
  }
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
        title: (event.replace ? event.session.title ?? existing?.title : existing?.title ?? event.session.title) ?? 'Untitled',
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
      if (store.pendingUpdates) next.pendingUpdates = Object.fromEntries(Object.entries(store.pendingUpdates).filter(([, updates]) => !updates.some((update) => 'sessionId' in update && update.sessionId === event.sessionId)))
      break
    }
    case 'message.upserted': {
      if (event.mode === 'commit' || event.mode === 'patch') {
        const messages = store.messages[event.sessionId] ?? []
        if (!messages.some((message) => message.id === event.messageId)) {
          next = queueUpdate(store, event.messageId, event)
          break
        }
        if (event.mode === 'commit') {
          next = withMessages(store, event.sessionId, messages.map((message) => message.id === event.messageId
            ? { ...message, timestamp: event.timestamp, timestampRaw: event.timestampRaw } : message))
          break
        }
        next = withMessages(store, event.sessionId, messages.map((message) => {
          if (message.id !== event.messageId) return message
          let parts = (event.reset ? message.parts.filter((part) => part.type !== 'retry' && part.type !== 'step-finish') : message.parts)
            .filter((part) => !('id' in part && part.id && event.removeParts?.includes(part.id)))
          for (const part of event.parts ?? []) parts = upsertPart(parts, part, true)
          return { ...message, ...(event.reset && { completedAt: undefined, statusInfo: undefined, error: undefined }), ...event.patch, parts, content: contentFor(message.role, parts) }
        }))
        break
      }
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
      next = applyPendingUpdates(next, message.id)
      break
    }
    case 'message.removed': {
      const located = locateMessage(store, event.messageId)
      if (located) next = withMessages(store, located.sessionId, store.messages[located.sessionId].filter((message) => message.id !== event.messageId))
      next = withPendingParts(next, event.messageId, [])
      if (store.pendingUpdates) {
        next.pendingUpdates = { ...store.pendingUpdates }
        delete next.pendingUpdates[event.messageId]
      }
      break
    }
    case 'part.upserted': {
      if (event.mode === 'tool-patch') {
        const located = locateMessage(store, event.messageId)
        const current = located?.message.parts ?? store.pendingParts[event.messageId] ?? []
        if (!event.update.name && !current.some((part) => part.type === 'tool' && part.id === event.update.id)) {
          next = queueUpdate(store, event.messageId, event)
          break
        }
        let parts = patchTool(current, event.update)
        for (const attachment of event.attachments ?? []) parts = upsertPart(parts, attachment, true)
        next = located ? replaceParts(store, located.sessionId, event.messageId, parts) : withPendingParts(store, event.messageId, parts)
        break
      }
      if (!event.replace && (event.part.type === 'patch' || event.part.type === 'step-start' || event.part.type === 'step-finish')) break
      const located = locateMessage(store, event.messageId)
      next = located ? replaceParts(store, located.sessionId, event.messageId, upsertPart(located.message.parts, event.part, event.replace))
        : withPendingParts(store, event.messageId, upsertPart(store.pendingParts[event.messageId] ?? [], event.part, event.replace))
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

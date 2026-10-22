import type { ArcheEvent } from '@/lib/harness/events'
import { createEmptyChatStore, prunePendingSessionUpdates, reduceArcheEvent } from '@/lib/workspace-events/reducer'
import type { MessagePart, WorkspaceMessage } from '@/types/workspace-runtime'

const MAX_CACHED_MESSAGES = 50

type LegacyEvent = { type: string; properties?: Record<string, unknown> }
type ToolPart = Extract<MessagePart, { type: 'tool' }>
type MissingTool = { sessionId: string; messageId: string; toolId: string }

type LegacyEventSerializer = {
  serialize: (event: ArcheEvent) => LegacyEvent[]
  missingToolIdentity: (event: ArcheEvent) => MissingTool | null
  seedToolIdentity: (target: MissingTool, tool: ToolPart) => void
}

function legacyPart(part: MessagePart, messageId: string, sessionId?: string): Record<string, unknown> {
  const scope = { messageID: messageId, sessionID: sessionId }
  if (part.type === 'tool') {
    const tool = part.name === 'subagent' ? 'task' : part.name === 'shell' ? 'bash' : part.name.replace(/^arche_tools_/, '')
    const input = part.name === 'subagent' ? {
      ...part.state.input,
      ...(typeof part.state.input.agent === 'string' && { subagent_type: part.state.input.agent }),
      ...(typeof part.state.input.sessionID === 'string' && { task_id: part.state.input.sessionID }),
    } : part.state.input
    return { ...scope, type: 'tool', id: part.id, callID: part.id, tool, state: { ...part.state, input } }
  }
  if (part.type === 'retry') return { ...scope, ...part, error: { message: part.error } }
  if (part.type === 'unknown') return { ...scope, ...part.data, type: part.originalType }
  return { ...scope, ...part }
}

function legacyMessage(message: WorkspaceMessage): LegacyEvent {
  return { type: 'message.updated', properties: { info: {
    id: message.id,
    sessionID: message.sessionId,
    role: message.role,
    agent: message.agentId,
    providerID: message.model?.providerId,
    modelID: message.model?.modelId,
    time: { created: message.timestampRaw, completed: message.completedAt },
    parts: message.parts.map((part) => legacyPart(part, message.id, message.sessionId)),
  } } }
}

export function createLegacyEventSerializer(): LegacyEventSerializer {
  let store = createEmptyChatStore()
  const recent = new Map<string, string | undefined>()

  const partsFor = (messageId: string): MessagePart[] => Object.values(store.messages).flat()
    .find((message) => message.id === messageId)?.parts ?? store.pendingParts[messageId] ?? []

  const boundCache = () => {
    while (recent.size > MAX_CACHED_MESSAGES) recent.delete(recent.keys().next().value!)
    store = {
      ...store,
      messages: Object.fromEntries(Object.entries(store.messages).flatMap(([id, messages]) => {
        const kept = messages.filter((message) => recent.has(message.id))
        return kept.length ? [[id, kept]] : []
      })),
      pendingParts: Object.fromEntries(Object.entries(store.pendingParts).filter(([id]) => recent.has(id))),
      pendingUpdates: Object.fromEntries(Object.entries(store.pendingUpdates ?? {}).filter(([id]) => recent.has(id))),
      sessions: [], sessionStatus: {}, permissions: {},
    }
  }

  return {
    missingToolIdentity(event) {
      if (event.type !== 'part.upserted' || event.mode !== 'tool-patch' || event.update.name ||
        partsFor(event.messageId).some((part) => part.type === 'tool' && part.id === event.update.id)) return null
      return { sessionId: event.sessionId, messageId: event.messageId, toolId: event.update.id }
    },
    seedToolIdentity(target, tool) {
      recent.set(target.messageId, target.sessionId)
      store = reduceArcheEvent(store, {
        v: 1, type: 'part.upserted', mode: 'tool-patch', sessionId: target.sessionId, messageId: target.messageId,
        update: { id: target.toolId, name: tool.name, input: tool.state.input },
      }).store
      boundCache()
    },
    serialize(event) {
      const messageId = 'messageId' in event ? event.messageId : event.type === 'message.upserted' ? event.message.id : undefined
      if (messageId) {
        recent.delete(messageId)
        recent.set(messageId, 'sessionId' in event ? event.sessionId : event.type === 'message.upserted' ? event.message.sessionId : undefined)
      }
      store = reduceArcheEvent(store, event).store
      boundCache()
      switch (event.type) {
        case 'session.status':
          if (event.status === 'idle') {
            store = prunePendingSessionUpdates(store, event.sessionId)
            for (const [id, sessionId] of recent) if (sessionId === event.sessionId) recent.delete(id)
            boundCache()
          }
          return [{ type: 'session.status', properties: { sessionID: event.sessionId, status: { type: event.status } } }]
        case 'session.error':
          return [{ type: 'session.error', properties: { sessionID: event.sessionId, message: event.message } }]
        case 'session.upserted':
          return [{ type: event.replace ? 'session.updated' : 'session.created', properties: { info: { id: event.session.id, title: event.session.title, parentID: event.session.parentId } } }]
        case 'session.removed':
          for (const [id, sessionId] of recent) if (sessionId === event.sessionId) recent.delete(id)
          return [{ type: 'session.deleted', properties: { info: { id: event.sessionId } } }]
        case 'message.upserted': {
          const id = event.mode ? event.messageId : event.message.id
          const message = Object.values(store.messages).flat().find((message) => message.id === id)
          if (message) return [legacyMessage(message)]
          if (event.mode === 'patch') return [{ type: 'message.updated', properties: { info: {
            id, sessionID: event.sessionId, role: 'assistant', time: { completed: event.patch.completedAt },
          } } }]
          return []
        }
        case 'message.removed':
          recent.delete(event.messageId)
          return [{ type: 'message.removed', properties: { messageID: event.messageId } }]
        case 'part.upserted': {
          const part = event.mode === 'tool-patch' ? partsFor(event.messageId).find((part) => part.type === 'tool' && part.id === event.update.id) : event.part
          return part ? [{ type: 'message.part.updated', properties: { part: legacyPart(part, event.messageId, event.sessionId) } },
            ...(event.mode === 'tool-patch' ? (event.attachments ?? []).map((attachment) => ({ type: 'message.part.updated', properties: { part: legacyPart(attachment, event.messageId, event.sessionId) } })) : []),
          ] : []
        }
        case 'part.delta':
          return [{ type: 'message.part.delta', properties: { sessionID: event.sessionId, messageID: event.messageId, partID: event.partId, field: event.field, delta: event.delta } }]
        case 'part.removed':
          return [{ type: 'message.part.removed', properties: { messageID: event.messageId, partID: event.partId } }]
        case 'permission.asked':
          return [{ type: 'permission.asked', properties: { ...event.permission, sessionID: event.permission.sessionId, messageID: event.permission.messageId, callID: event.permission.callId } }]
        case 'permission.resolved':
          return [{ type: 'permission.replied', properties: { sessionID: event.sessionId, requestID: event.permissionId } }]
        case 'workspace.touched':
          return [{ type: 'file.edited', properties: {} }]
        case 'knowledge.proposals_changed':
          return [{ type: event.type }]
      }
    },
  }
}

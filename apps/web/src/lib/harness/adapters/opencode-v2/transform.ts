import type { SessionStructuredError } from '@opencode/client'

import { formatTimestamp } from '@/lib/format-timestamp'
import type { HarnessMessage, HarnessSession } from '@/lib/harness/contract'
import type { HarnessError } from '@/lib/harness/errors'
import type { ArchePermission } from '@/lib/harness/events'
import { getCanonicalProviderId } from '@/lib/providers/catalog'
import { getString, isRecord } from '@/lib/records'
import type { MessagePart, ToolState } from '@/types/workspace-runtime'

function number(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined
}

function serializable(value: unknown): unknown {
  if (typeof value === 'bigint') return value.toString()
  if (value instanceof Date) return value.toISOString()
  if (Array.isArray(value)) return value.map(serializable)
  if (isRecord(value)) return Object.fromEntries(Object.entries(value).map(([key, entry]) => [key, serializable(entry)]))
  return value
}

function record(value: unknown): Record<string, unknown> | undefined {
  const normalized = serializable(value)
  return isRecord(normalized) ? normalized : undefined
}

export function contentPartId(messageId: string, kind: 'text' | 'reasoning', ordinal: number): string {
  return `${messageId}:${kind}:${ordinal}`
}

export function toHarnessError(value: unknown): HarnessError | undefined {
  if (!isRecord(value)) return undefined
  const type = getString(value.type)
  const message = getString(value.message)
  if (!type || !message) return undefined
  const error: SessionStructuredError = { type, message }
  const status = number(value.status)
  return {
    code: /^provider[._-](auth|credential)|^ProviderAuthError$/i.test(error.type) || /api key is missing|provider credential|configure .*provider/i.test(error.message)
      ? 'provider_auth_missing' : 'runtime_error',
    detail: `${error.type}: ${error.message}`,
    ...(status !== undefined && { status }),
  }
}

function filePart(id: string, uri: string, mime: string, filename?: string): MessagePart {
  let path = ''
  if (uri.startsWith('file://')) {
    try {
      const pathname = decodeURIComponent(new URL(uri).pathname).replaceAll('\\', '/')
      if (pathname.startsWith('/workspace/')) path = pathname.slice('/workspace/'.length)
      else {
        const index = pathname.indexOf('/.arche/attachments/')
        if (index >= 0) path = pathname.slice(index + 1)
      }
    } catch {
      path = ''
    }
  }
  return { type: 'file', id, path, url: uri, mime, ...(filename !== undefined && { filename }) }
}

function unknownPart(value: Record<string, unknown>): MessagePart {
  return { type: 'unknown', originalType: getString(value.type) ?? 'unknown', data: record(value) ?? {} }
}

function transformTool(value: Record<string, unknown>): MessagePart[] {
  const id = getString(value.id)
  const name = getString(value.name)
  const state = isRecord(value.state) ? value.state : undefined
  if (!id || !name || !state || !isRecord(state.input)) return [unknownPart(value)]
  const input = record(state.input) ?? {}
  const metadata = record(state.metadata)
  const metadataProps = metadata ? { metadata } : {}
  let normalized: ToolState
  if (state.status === 'running') {
    const title = getString(metadata?.title)
    normalized = { status: 'running', input, ...(title !== undefined && { title }), ...metadataProps }
  } else if (state.status === 'completed' && Array.isArray(state.content)) {
    if (state.content.some((entry) => !isRecord(entry) || (entry.type !== 'text' && entry.type !== 'file'))) return [unknownPart(value)]
    const output = state.content.flatMap((entry: unknown) => isRecord(entry) && entry.type === 'text' && typeof entry.text === 'string' ? [entry.text] : []).join('\n')
    normalized = { status: 'completed', input, output, title: getString(metadata?.title) ?? name, ...metadataProps }
  } else if (state.status === 'error') {
    const error = toHarnessError(state.error)
    if (!error?.detail) return [unknownPart(value)]
    normalized = { status: 'error', input, error: error.detail, ...metadataProps }
  } else return [unknownPart(value)]
  const parts: MessagePart[] = [{ type: 'tool', id, name, state: normalized }]
  if (Array.isArray(state.content)) {
    state.content.forEach((entry: unknown, index: number) => {
      if (isRecord(entry) && entry.type === 'file' && typeof entry.uri === 'string' && typeof entry.mime === 'string') {
        parts.push(filePart(`${id}:file:${index}`, entry.uri, entry.mime, getString(entry.name)))
      }
    })
  }
  return parts
}

export function transformParts(content: unknown[], messageId: string): MessagePart[] {
  const ordinals = { text: 0, reasoning: 0 }
  return content.flatMap((value: unknown): MessagePart[] => {
    if (!isRecord(value)) return []
    if ((value.type === 'text' || value.type === 'reasoning') && typeof value.text === 'string') {
      return [{ type: value.type, id: contentPartId(messageId, value.type, ordinals[value.type]++), text: value.text }]
    }
    if (value.type === 'tool') return transformTool(value)
    return [unknownPart(value)]
  })
}

export function accountingPart(messageId: string, value: unknown): MessagePart | null {
  if (!isRecord(value) || !isRecord(value.tokens)) return null
  const cost = number(value.cost)
  const input = number(value.tokens.input)
  const output = number(value.tokens.output)
  const reason = getString(value.finish) ?? (toHarnessError(value.error) ? 'error' : undefined)
  if (cost === undefined || input === undefined || output === undefined || reason === undefined) return null
  return { type: 'step-finish', id: `${messageId}:usage`, reason, cost, tokens: { input, output } }
}

export function toHarnessSession(value: unknown): HarnessSession | null {
  if (!isRecord(value) || !getString(value.id) || !isRecord(value.time)) return null
  const createdAtRaw = number(value.time.created)
  const updatedAtRaw = number(value.time.updated)
  if (createdAtRaw === undefined || updatedAtRaw === undefined) return null
  const parentId = getString(value.parentID)
  return {
    id: String(value.id), title: getString(value.title) ?? 'Untitled',
    status: value.outcome === 'failed' ? 'error' : 'idle',
    updatedAt: formatTimestamp(updatedAtRaw), updatedAtRaw, createdAtRaw,
    ...(parentId !== undefined && { parentId }),
  }
}

export function toHarnessMessage(value: unknown): HarnessMessage | null {
  if (!isRecord(value)) return null
  const id = getString(value.id)
  const sessionId = getString(value.sessionID)
  const created = isRecord(value.time) ? number(value.time.created) : undefined
  if (!id || !sessionId || created === undefined) return null
  const type = value.type
  if (type !== 'assistant' && type !== 'user' && type !== 'system' && type !== 'synthetic') return null
  if (type === 'assistant' ? !Array.isArray(value.content) : typeof value.text !== 'string') return null
  const parts = type === 'assistant' && Array.isArray(value.content)
    ? transformParts(value.content, id) : [{ type: 'text' as const, id: `${id}:text:0`, text: String(value.text) }]
  if (type === 'user' && Array.isArray(value.files)) {
    value.files.forEach((attachment: unknown, index: number) => {
      if (!isRecord(attachment) || typeof attachment.mime !== 'string' || typeof attachment.data !== 'string') return
      const source = isRecord(attachment.source) ? attachment.source : undefined
      const uri = source?.type === 'uri' && typeof source.uri === 'string'
        ? source.uri : `data:${attachment.mime};base64,${attachment.data}`
      parts.push(filePart(`${id}:file:${index}`, uri, attachment.mime, getString(attachment.name)))
    })
  }
  if (type === 'user') {
    for (const [index, agent] of (Array.isArray(value.agents) ? value.agents : []).entries()) {
      if (isRecord(agent) && typeof agent.name === 'string') parts.push({ type: 'agent', id: `${id}:agent:${index}`, name: agent.name })
    }
    for (const skill of Array.isArray(value.skills) ? value.skills : []) {
      if (isRecord(skill)) parts.push(unknownPart({ ...skill, type: 'skill' }))
    }
  }
  if (type === 'assistant') {
    const usage = accountingPart(id, value)
    if (usage) parts.push(usage)
    if (isRecord(value.retry) && number(value.retry.attempt) !== undefined) {
      const error = toHarnessError(value.retry.error)
      if (error?.detail) parts.push({ type: 'retry', id: `${id}:retry`, attempt: Number(value.retry.attempt), error: error.detail })
    }
  }
  const completed = isRecord(value.time) ? number(value.time.completed) : undefined
  const error = toHarnessError(value.error)
  const agentId = getString(value.agent)
  const model = isRecord(value.model) ? value.model : undefined
  const providerId = getString(model?.providerID)
  const modelId = getString(model?.id)
  const role = type === 'synthetic' ? 'system' : type
  return {
    id, sessionId, role,
    ...(agentId !== undefined && { agentId }),
    ...(providerId && modelId && { model: { providerId: getCanonicalProviderId(providerId) ?? providerId, modelId } }),
    content: role === 'user' ? String(value.text) : parts.flatMap((part) => (part.type === 'text' || part.type === 'reasoning') && part.text.trim() ? [part.text] : []).join('\n'),
    timestamp: formatTimestamp(created), timestampRaw: created,
    ...(completed !== undefined && { completedAt: completed }),
    ...(error && { error, statusInfo: { status: 'error', detail: error.detail } }),
    parts,
  }
}

export function toArchePermission(value: unknown): ArchePermission | null {
  if (!isRecord(value)) return null
  const id = getString(value.id)
  const sessionId = getString(value.sessionID)
  const action = getString(value.action)
  if (!id || !sessionId || !action || !Array.isArray(value.resources) || !value.resources.every((entry) => typeof entry === 'string')) return null
  const source = isRecord(value.source) && value.source.type === 'tool' ? value.source : undefined
  const messageId = getString(source?.messageID)
  const callId = getString(source?.id)
  const metadata = record(value.metadata)
  const pattern = value.resources.join(', ')
  return {
    id, sessionId, title: getString(value.message) ?? `${action}: ${pattern}`, permissionType: action, pattern,
    ...(messageId !== undefined && { messageId }), ...(callId !== undefined && { callId }),
    ...(metadata && { metadata }), state: 'pending',
  }
}

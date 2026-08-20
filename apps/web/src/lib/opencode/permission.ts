import { isRecord } from '@/lib/records'

export type WorkspacePermission = {
  id: string
  sessionId: string
  messageId?: string
  callId?: string
  title: string
  pattern?: string
  metadata?: Record<string, unknown>
  state: 'pending'
}

function getString(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value.trim() : undefined
}

function getPermissionPattern(permission: Record<string, unknown>): string | undefined {
  if (Array.isArray(permission.patterns)) {
    const patterns = permission.patterns
      .map(getString)
      .filter((pattern): pattern is string => Boolean(pattern))
    if (patterns.length > 0) return patterns.join(', ')
  }

  if (Array.isArray(permission.resources)) {
    const resources = permission.resources
      .map(getString)
      .filter((resource): resource is string => Boolean(resource))
    if (resources.length > 0) return resources.join(', ')
  }

  return getString(permission.pattern)
}

/**
 * Normalize a pending permission payload (v1 `permission`, v2 `info`, flat
 * shapes) into a single `WorkspacePermission`. The reducer only ever sees the
 * normalized form.
 */
export function normalizePendingPermission(
  value: unknown,
  fallback: { sessionId?: string; messageId?: string } = {},
): WorkspacePermission | null {
  if (!isRecord(value)) return null

  const tool = isRecord(value.tool) ? value.tool : null
  const source = isRecord(value.source) ? value.source : null
  const id = getString(value.id)
  const sessionId = getString(value.sessionID) ?? getString(value.sessionId) ?? fallback.sessionId
  if (!id || !sessionId) return null

  const pattern = getPermissionPattern(value)
  const metadata = isRecord(value.metadata) ? value.metadata : undefined
  const messageId =
    getString(tool?.messageID) ??
    getString(tool?.messageId) ??
    getString(source?.messageID) ??
    getString(source?.messageId) ??
    getString(value.messageID) ??
    getString(value.messageId) ??
    fallback.messageId
  const callId =
    getString(tool?.callID) ??
    getString(tool?.callId) ??
    getString(source?.callID) ??
    getString(source?.callId) ??
    getString(value.callID) ??
    getString(value.callId)

  return {
    id,
    sessionId,
    ...(messageId && { messageId }),
    ...(callId && { callId }),
    title:
      getString(value.permission) ??
      getString(value.title) ??
      getString(value.action) ??
      pattern ??
      'Tool approval required',
    ...(pattern && { pattern }),
    ...(metadata && { metadata }),
    state: 'pending',
  }
}

/** Extract the permission payload from a permission event. */
export function getPermissionEventPayload(event: unknown): Record<string, unknown> | null {
  if (!isRecord(event) || !isRecord(event.properties)) return null

  const { properties } = event
  if (isRecord(properties.permission)) return properties.permission
  if (isRecord(properties.info)) return properties.info
  return properties
}

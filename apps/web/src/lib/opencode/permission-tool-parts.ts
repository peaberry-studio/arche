import type { WorkspaceMessage } from '@/lib/opencode/types'
import type { WorkspacePermission } from '@/lib/opencode/permission'

export type PermissionToolPart = {
  toolName: string
  input: Record<string, unknown>
}

/**
 * Permission preview resolution:
 * - `PermissionToolPart` — the referenced tool call was found.
 * - `null` — the permission's session messages are loaded but no tool part
 *   matches; retrieval failed and the approval must not proceed blindly.
 * - `undefined` — the referenced session's messages are not (yet) loaded;
 *   keep waiting for hydration.
 */
export type ResolvedPermissionToolPart = PermissionToolPart | null | undefined

// Correlates pending permissions with tool parts across all cached session
// messages (including delegated child sessions already in the store). Tool
// parts and permission events can arrive in either order, so callers recompute
// this reactively whenever messages or permissions change.
export function selectPermissionToolParts(
  messagesBySession: Record<string, WorkspaceMessage[]>,
  permissions: WorkspacePermission[]
): Record<string, ResolvedPermissionToolPart> {
  const toolPartsByCallId = new Map<string, PermissionToolPart>()
  const loadedSessions = new Set<string>()

  for (const [sessionId, messages] of Object.entries(messagesBySession)) {
    if (!Array.isArray(messages)) continue
    loadedSessions.add(sessionId)

    for (const message of messages) {
      if (!Array.isArray(message.parts)) continue

      for (const part of message.parts) {
        if (part.type !== 'tool') continue
        toolPartsByCallId.set(part.id, {
          toolName: part.name,
          input: part.state.input ?? {},
        })
      }
    }
  }

  const resolved: Record<string, ResolvedPermissionToolPart> = {}
  for (const permission of permissions) {
    if (!permission.callId) continue

    const matched = toolPartsByCallId.get(permission.callId)
    if (matched) {
      resolved[permission.id] = matched
      continue
    }

    resolved[permission.id] = loadedSessions.has(permission.sessionId) ? null : undefined
  }

  return resolved
}

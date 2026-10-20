/**
 * OpenCode wire events, consumed only by the server adapter and its test oracle.
 */
export type OpenCodeEvent = {
  type: string
  properties?: Record<string, unknown>
}

export const WORKSPACE_TOUCH_EVENT_TYPES = new Set([
  'file.created',
  'file.edited',
  'file.deleted',
  'file.watcher.updated',
  'todo.updated',
])

export function isWorkspaceTouchEvent(type: string): boolean {
  return WORKSPACE_TOUCH_EVENT_TYPES.has(type)
}

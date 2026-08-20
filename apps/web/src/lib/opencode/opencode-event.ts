/**
 * Canonical OpenCode event shape received over the workspace event bus.
 *
 * The BFF re-dispatches the OpenCode event payload as-is (SSE `data: {json}`).
 * Clients apply events through the pure reducer in `event-reducer.ts`.
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

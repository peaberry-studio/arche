/**
 * In-process pub/sub broadcast keyed by user id, used to push workspace-level
 * notifications (e.g. knowledge proposal changes) into the SSE pipes of the
 * user's connected browser sessions.
 *
 * SINGLE-PROCESS CONSTRAINT: listeners live in the memory of one web process.
 * Both creation boundaries (internal learning proposals API, MCP knowledge
 * tools) and `GET /api/w/[slug]/events` share that process while the compose
 * stack runs a single web replica. Scaling the web tier out to multiple
 * replicas requires migrating this registry to Postgres LISTEN/NOTIFY or Redis.
 */

export type WorkspaceBroadcastEvent = {
  type: string
  properties?: Record<string, unknown>
}

type WorkspaceBroadcastListener = (event: WorkspaceBroadcastEvent) => void

declare global {
  var workspaceBroadcastListeners: Map<string, Set<WorkspaceBroadcastListener>> | undefined
}

function getRegistry(): Map<string, Set<WorkspaceBroadcastListener>> {
  globalThis.workspaceBroadcastListeners ??= new Map()
  return globalThis.workspaceBroadcastListeners
}

export function subscribeWorkspaceEvents(
  userId: string,
  listener: WorkspaceBroadcastListener,
): () => void {
  const registry = getRegistry()
  let listeners = registry.get(userId)
  if (!listeners) {
    listeners = new Set()
    registry.set(userId, listeners)
  }
  listeners.add(listener)

  return () => {
    const current = getRegistry().get(userId)
    if (!current || !current.delete(listener)) return
    if (current.size === 0) registry.delete(userId)
  }
}

export function publishWorkspaceEvent(
  userId: string,
  event: WorkspaceBroadcastEvent,
): void {
  const listeners = globalThis.workspaceBroadcastListeners?.get(userId)
  if (!listeners || listeners.size === 0) return
  for (const listener of [...listeners]) listener(event)
}

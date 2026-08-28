## Why

The Curator badge count in the workspace sidebar goes stale during a live session: proposals created by `learning_propose` (learning runs, chat agents) and by MCP knowledge tools are persisted through direct HTTP calls that never notify the browser, and the count only refreshes on reconnect, curator open, publish/discard, or a manual learning run. Users see an outdated badge until they reload or click the Curator.

## What Changes

- Add an in-process pub/sub broker keyed by user id that broadcasts workspace-level events inside the web process.
- Publish a `knowledge.proposals_changed` event at the two server boundaries that create knowledge review proposals: the internal learning proposals API (used by the `learning_propose` tool) and the MCP knowledge tool handlers.
- Inject broker events for the authenticated user into the existing workspace SSE pipe (`GET /api/w/[slug]/events`) alongside the re-dispatched OpenCode events.
- In the workspace event bus client, intercept the `knowledge.proposals_changed` event type (without touching the pure OpenCode reducer) and trigger a debounced refresh of the pending-proposals count.
- On event-bus (re)connect, refresh the pending count alongside the existing hydration so events missed while the pipe was down are recovered.

Non-goals: mounting the event bus on the explore route (badge behavior there stays as today), cross-process broadcast (single web replica today), and changing proposal creation flows themselves.

## Capabilities

### New Capabilities
- `knowledge-proposal-events`: live propagation of knowledge review proposal changes to connected browser sessions — publication at creation boundaries, delivery over the workspace event stream, and client-side badge refresh.

### Modified Capabilities
<!-- None: no existing spec's requirements change. `workspace-startup` is unaffected. -->

## Impact

- **New module** `apps/web/src/lib/runtime/workspace-broadcast.ts` (broker, server-only).
- **Server routes**: `apps/web/src/app/api/internal/learning/proposals/route.ts` (publish on success), `apps/web/src/app/api/w/[slug]/events/route.ts` (subscribe + inject events).
- **MCP server**: `apps/web/src/lib/mcp/server.ts` (publish on successful knowledge review submissions).
- **Client**: `apps/web/src/hooks/workspace/use-workspace-event-bus.ts` (new callback option + debounce), `apps/web/src/hooks/workspace/use-workspace-composed.ts` (wire `refreshKnowledgePendingCount`).
- **Tests**: new broker unit tests; extended tests for the proposals route, MCP server, and event bus hook.
- **Constraints**: broker assumes a single web process (one replica in `infra/compose`); scaling out requires migrating to Postgres `LISTEN/NOTIFY` or Redis.

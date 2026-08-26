## Context

See proposal.md for motivation. Current mechanics that shape the approach:

- The pending-proposal count lives in `WorkspaceRuntimeContext` and only changes when `refreshKnowledgePendingCount()` (`GET /api/u/[slug]/learning`) runs — today triggered by connect/auto-sync, curator open, publish/discard/conflict resolution, or a manual learning run.
- Proposals are created through two server boundaries that run in the same Node process as the SSE route: `POST /api/internal/learning/proposals` (called by the `learning_propose` tool from workspace containers) and the MCP knowledge tools (`/api/mcp` → `submitMcpKnowledgeReviewChange`). Both converge on `createKnowledgeReviewChange`.
- `GET /api/w/[slug]/events` is a thin authenticated proxy (`withAuth`) that re-dispatches the OpenCode `/event` SSE stream unchanged; the client (`use-workspace-event-bus`) applies events through a pure reducer and only refreshes vault diffs/files when an event is a workspace-touch event.
- The event bus is mounted only on the chat route (`WorkspaceShell` → `useWorkspace`); the explore route uses `useExploreWorkspace` with no bus.
- The web service runs as a single replica (`infra/compose`).

## Goals / Non-Goals

**Goals:**
- Badge updates live when proposals are created, on both creation paths, with no new client connections.
- Keep the OpenCode event proxy route and the client reducer untouched in behavior: notifications are additive and intercepted before reduction.
- Recover correctness after SSE disconnects (refresh on reconnect) and coalesce bursts so a curator run proposing N files does not fire N fetches.

**Non-Goals:**
- Mounting the event bus on the explore route or lifting it to the layout provider (badge behavior there stays as today).
- Cross-process/replica broadcast (no Postgres LISTEN/NOTIFY, no Redis) — deferred until the deployment model needs it.
- Notifying about proposal status changes beyond creation (publish/discard/rebase already refresh through existing flows in the shells).

## Decisions

### 1. Push over the existing SSE pipe instead of polling or tool-part sniffing
- **Choice:** Server pushes a synthetic `knowledge.proposals_changed` event through `GET /api/w/[slug]/events`.
- **Alternatives:** (a) Poll `/api/u/[slug]/learning` on a timer — laggier, constant load, and the badge exists on routes without any poller. (b) Detect `learning_propose` tool parts in the client reducer — heuristic, misses the MCP path (different tool names), couples the reducer to tool surface details. Rejected.
- **Rationale:** The pipe already exists per browser session, is authenticated per user, and multiplexing one more event type is additive on both ends.

### 2. In-process broker keyed by user id, singleton on `globalThis`
- **Choice:** New server-only module `lib/runtime/workspace-broadcast.ts` exposing `subscribeWorkspaceEvents(userId, listener)` / `publishWorkspaceEvent(userId, event)`, with the listener registry held on `globalThis` (same idiom as `lib/prisma.ts`) so Next.js dev/HMR module reloads don't fork the registry. Empty sets are deleted on unsubscribe; publishing with no listeners is a no-op.
- **Alternatives:** Postgres `LISTEN/NOTIFY` now — unnecessary for a single-replica deployment and adds a migration surface. Rejected for now, documented as the migration path if the web tier scales out.
- **Rationale:** Both creation boundaries and the SSE route share one process today; the simplest mechanism that satisfies the spec wins.

### 3. Publish at the route/tool boundary, not inside the repository
- **Choice:** Emit after a successful `createKnowledgeReviewChange` in the internal proposals route (using `context.userId`) and in `submitMcpKnowledgeReviewChange` (using `args.user.id`).
- **Alternatives:** Emit inside `createKnowledgeReviewChange` — rejected: the repository is a pure persistence layer (also used by flows whose callers already refresh, e.g. publish/discard), and route boundaries are where actor identity is unambiguous.
- **Rationale:** Minimal blast radius; persistence layer stays free of transport concerns. Deliberately not tied to `workspaceTouched` (file events) either — that would refetch `/learning` on every file edit.

### 4. SSE route subscribes per connection; injection is fail-safe
- **Choice:** Inside the `withAuth` handler, subscribe to the authenticated user's events; the listener enqueues a `data: {...}\n\n` frame guarded by the existing `closed` flag and wrapped in try/catch → `close()`. Unsubscribe in `close()` and in `cancel()`. Event frames are shaped exactly like re-dispatched OpenCode frames (`{type, properties}`) so the client parser needs no changes.
- **Rationale:** A slow/closed browser must never break proposal creation; publish() is fire-and-forget regardless.

### 5. Client intercepts before the reducer; dedicated debounce; refresh on (re)connect
- **Choice:** In `use-workspace-event-bus`, add optional `onKnowledgeProposalsChanged` callback. In the read loop, match the `knowledge.proposals_changed` type before `dispatchReducerEvent` (skip reduction entirely — `continue`). Debounce the callback (~500ms, mirroring `scheduleWorkspaceRefresh`) so a burst of proposals triggers one count fetch. Fire the callback once on every successful bus (re)connect next to `hydrateOnConnectRef`, covering events missed while the pipe was down.
- **Alternatives:** Teach the reducer a new event type — rejected: the reducer owns chat/session state; a badge signal has no business mutating the ChatStore, and `sessionStatus`/messages must not react to it (spec requirement).
- **Wiring:** `use-workspace-composed` passes `refreshKnowledgePendingCount` from `useWorkspaceRuntime()` as the callback. No shell changes.

### 6. Event type name
- **Choice:** `knowledge.proposals_changed` — dotted namespace, no collision with OpenCode event types (`session.*`, `message.*`, `file.*`, `permission.*`), stable string shared by server publishers and the client matcher via a small client-safe constant module (broker stays server-only).

## Risks / Trade-offs

- [Broker is in-process; a second web replica would silently miss cross-replica events] → Documented in the broker header as the known constraint; migration path is LISTEN/NOTIFY or Redis. Acceptable while compose runs one replica.
- [Explore route has no bus, badge there stays stale until navigation/curator open] → Pre-existing behavior, explicitly out of scope; follow-up would lift the bus to the layout provider.
- [Multi-tab: every tab holds its own SSE pipe and will each fetch the count once] → Acceptable (idempotent GET, tiny payload); no dedup needed.
- [Enqueue on a closed/errored stream throws] → All listener enqueue paths are guarded (`closed` flag + try/catch → `close()`), and `publish` never awaits listener outcomes.
- [Dev-mode module reload duplicates listeners] → Registry on `globalThis` survives HMR; unsubscribe paths (`close`/`cancel`) keep sets clean.

## Migration Plan

Additive only: no schema changes, no new endpoints, no wire-format changes to existing events. Deploy is a single rollout; rollback is a revert. Old clients that never match `knowledge.proposals_changed` simply keep today's behavior, so the server can ship before/independently of any client cache concerns.

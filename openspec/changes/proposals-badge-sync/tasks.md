## 1. Broker and shared constant (server)

- [x] 1.1 Create client-safe constant module exporting `KNOWLEDGE_PROPOSALS_CHANGED_EVENT = 'knowledge.proposals_changed'` (no server imports) and verify it imports cleanly from both a route module and the client hook in isolation
- [x] 1.2 Create server-only `apps/web/src/lib/runtime/workspace-broadcast.ts` with `subscribeWorkspaceEvents(userId, listener): () => void` and `publishWorkspaceEvent(userId, event)`: registry on `globalThis`, empty sets deleted on unsubscribe, publish with no listeners is a no-op; header comment documents the single-process constraint and the LISTEN/NOTIFY migration path
- [x] 1.3 Add `apps/web/src/lib/runtime/__tests__/workspace-broadcast.test.ts` covering: subscriber receives event for its user only, unsubscribe stops delivery and cleans the registry, publish without listeners does not throw, distinct users are isolated — verify with `pnpm test`

## 2. Publish at proposal creation boundaries

- [x] 2.1 In `apps/web/src/app/api/internal/learning/proposals/route.ts`, publish `KNOWLEDGE_PROPOSALS_CHANGED_EVENT` for `context.userId` after a successful `createKnowledgeReviewChange` only; verify in `__tests__/route.test.ts` that publish is called on success and not called on validation/base-capture/persistence failures
- [x] 2.2 In `apps/web/src/lib/mcp/server.ts` (`submitMcpKnowledgeReviewChange`), publish for `args.user.id` after a successful create/update/delete submission only; verify in `__tests__/server.test.ts` success and failure cases
- [x] 2.3 Run the two touched test suites and confirm green: `pnpm test src/app/api/internal/learning/proposals src/lib/mcp`

## 3. SSE injection

- [x] 3.1 In `apps/web/src/app/api/w/[slug]/events/route.ts`, subscribe to the authenticated user's events inside the handler; the listener enqueues a `data: {json}\n\n` frame shaped like existing frames, guarded by the `closed` flag and wrapped in try/catch → `close()`; unsubscribe in both `close()` and `cancel()`; verify upstream OpenCode frames still pass through unchanged and heartbeats keep flowing (manual check via existing behavior, route has no test harness)
  - Note: the route did have a test harness; extended `__tests__/route.test.ts` with inject / unsubscribe-on-disconnect / unsubscribe-on-cancel tests instead of manual verification.
- [ ] 3.2 Verify with a running stack: `curl -N` the event stream with a valid session while POSTing to `/api/internal/learning/proposals` (instance auth headers) — the `knowledge.proposals_changed` frame appears on the stream and a second connected user's stream stays silent

## 4. Client handling and wiring

- [x] 4.1 In `apps/web/src/hooks/workspace/use-workspace-event-bus.ts`, add optional `onKnowledgeProposalsChanged` option; match the event type in the read loop before `dispatchReducerEvent` and skip reduction; debounce the callback (~500ms, mirror `scheduleWorkspaceRefresh`); call it once on every successful bus (re)connect next to `hydrateOnConnectRef`
- [x] 4.2 In `apps/web/src/hooks/workspace/use-workspace-composed.ts`, pass `refreshKnowledgePendingCount` from `useWorkspaceRuntime()` as `onKnowledgeProposalsChanged`
- [x] 4.3 Extend `apps/web/src/hooks/__tests__/use-workspace-event-bus.test.tsx` (fake timers): a `knowledge.proposals_changed` SSE frame invokes the callback exactly once per burst, does not mutate the store, and the callback fires on reconnect; ordinary OpenCode events still reduce — verify with `pnpm test src/hooks/__tests__/use-workspace-event-bus.test.tsx`

## 5. End-to-end verification

- [x] 5.1 Run full suite and lint from `apps/web/`: `pnpm test` and `pnpm lint` both pass
- [ ] 5.2 Manual check per spec: workspace open on chat route, trigger a learning run without opening the Curator — badge increments live; reload not required; conversation streaming is unaffected while notifications arrive
- [ ] 5.3 Run `bash scripts/check-podman-images.sh` from the repo root before declaring the change PR-ready (per AGENTS.md)
  - Attempted: the web image's Next.js production build succeeded, but the final image commit failed with `no space left on device` from podman's storage (full podman machine disk, unrelated to the change). Needs re-run once podman storage is freed.

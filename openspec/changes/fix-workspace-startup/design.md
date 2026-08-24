## Context

See proposal.md - Why for the two production failures: a blocking health check with no per-request timeout, and a startup race where a stale attempt destroys a container another flow already confirmed. The current state that shapes the approach:

- `isInstanceHealthyWithPassword(slug, password, overrideBaseUrl?)` in `src/lib/opencode/client.ts` issues a `fetch()` with no `AbortSignal` or per-request timeout. It is also called from `getInstanceStatus()` (`core.ts:201`), so bounding it protects every call site, not just startup.
- `waitForHealthy()` (`core.ts:295`) probes the direct container IP first and the DNS hostname second, sequentially, with the total-startup deadline checked only between loop iterations. A single hanging request therefore blocks the whole loop and is not bounded by `ARCHE_START_TIMEOUT_MS`.
- Instance mutations (`setRunning`, `setError`, `correctToRunning`) update by `slug` unconditionally. `containerId` already exists and is set after container creation, so it can key race-safe transitions without a migration.
- `use-instance-startup.ts` arms its 120 s timeout only after the first `ensureInstanceRunningAction()` resolves with `starting`; a hanging first call arms neither polling nor the timeout.
- An existing deliberate behavior and test allow startup to continue on direct-IP success when the DNS hostname is unavailable. This design keeps that fallback but bounds it.

## Goals / Non-Goals

**Goals:**
- Every `/health` request has a hard per-request deadline enforced by aborting it.
- Total startup health-check honors `ARCHE_START_TIMEOUT_MS`; no individual request outlives the remaining budget.
- DNS and direct-IP probing cannot stall each other.
- Instance state transitions and container cleanup are conditional on the attempt's `containerId`, so a stale request cannot corrupt or delete a newer attempt's result.
- `running` is published only after health check + provider sync; a recent `starting` instance stays `starting` on reads.
- The frontend shows an error instead of an infinite "Starting workspace" screen.

**Non-Goals:**
- Fixing stale Server Action bundles from a prior deployment (tracked separately).
- Changing the desktop host path (`workspace-host-desktop.ts`), which has no container semantics.
- Migration of persisted data: none needed.

## Decisions

### D1. Per-request timeout in the health client
`isInstanceHealthyWithPassword()` gains an optional `{ timeoutMs }` option and creates an `AbortController` per `/global/health` request. On expiration it returns `{ ok: false, detail: 'healthcheck_timeout' }`. The default timeout is ~5s so the existing `getInstanceStatus()` call site is bounded too. Alternative considered: relying on a global fetch timeout, rejected because it cannot abort an already-established idle connection and cannot express per-attempt budgets.

### D2. Bounded, non-blocking health probes in `waitForHealthy`
Each probe receives a deadline of `min(perAttemptMs, remainingBudgetMs)` computed from the start of the startup. The loop no longer waits on a single unbounded request. The direct-IP probe is attempted first but with a hard per-attempt deadline, and the DNS probe runs with the same budget; if the direct-IP probe fails or times out, the DNS probe decides. The losing in-flight request (when probing in parallel) is cancelled once one confirms health.

### D3. Preserve the direct-IP fallback (bounded)
The current deliberate behavior — continue startup using the direct-IP address when DNS is unhealthy but direct IP responds — is kept, only now time-bounded. Alternative (fully gating `running` on DNS) was considered and rejected because the BFF already targets `opencode-${slug}` by DNS in the common path; changing the policy is a product decision out of scope here. The bounded fallback keeps the existing test green while removing the blocking.

### D4. Conditional state transitions by `containerId`
Add to `instance.ts`:
- `setRunningIfCurrentContainer(slug, containerId, configSha)` → `updateMany({ where: { slug, status: 'starting', containerId }, data: { status: 'running', lastActivityAt, appliedConfigSha } })`
- `setErrorIfCurrentContainer(slug, containerId)` → `updateMany({ where: { slug, status: 'starting', containerId }, data: { status: 'error', containerId: null, ... } })`
- `correctToRunningIfCurrentContainer(slug, containerId)` for the reconciliation path.

Each returns the affected-row count so callers can detect a lost race. `updateMany` was chosen over `update` because it can express the compound guard atomically.

### D4. Guarded cleanup in `startInstance`
The attempt captures its `containerId` at creation. On both the timeout path and the generic `catch` path, before `stopContainer`/`removeContainer`/`setError`:
1. Run the conditional transition to `error`.
2. Stop/remove the container **only if** the transition affected a row, **or** the current DB `containerId` no longer equals the attempt's own (in which case the attempt removes only its own now-orphaned container, never the current one).
3. If the attempt lost the race for a still-current container (transition affected 0 rows and the DB still references the same `containerId`), do not touch the container; re-read and return the current state.

This covers the scenario where the generic `catch` fires after another flow confirmed `running`.

### D5. Do not publish `running` prematurely; reconcile interrupted startups
`getInstanceStatus()` stops flipping a recent `starting` instance to `running` on health alone. Recovery moves into the reconciliation route: a status check on a `starting` instance whose attempt is no longer fresh performs container-verify → bounded health check → provider sync → `correctToRunningIfCurrentContainer`. This is the only non-`startInstance` path that may publish `running`.

### D6. Frontend timeout armed before the server action
`use-instance-startup.ts` marks the attempt `starting` and arms the timeout before awaiting the server action, tags the attempt with a local id, and when the timeout fires shows the error and ignores a late response for that attempt. The client timeout is set to `ARCHE_START_TIMEOUT_MS + margin` (not equal) so the client does not time out while the server is legitimately about to succeed.

## Risks / Trade-offs

- [Aborting a fetch that is mid-flight] → `AbortController` is the supported mechanism; the health client maps the abort to `healthcheck_timeout` and the test asserts no dangling promise.
- [Parallel DNS/direct probes add concurrency complexity] → The bounded-sequential variant is preferred for the common path; parallel with cancel is an optimization, not a requirement.
- [Removing premature `correctToRunning` changes status-read behavior] → Existing tests asserting that path are re-specified; the reconciliation route preserves recovery so workspaces are not stuck in `starting`.
- [A lost-race attempt may orphan its own container] → The cleanup rule in D4 removes only the attempt's own container by id when the DB no longer references it; it never touches the current `containerId`.

## Migration Plan

- No DB migration: `containerId` already exists.
- Behavior is deployable as a single release. Rollback: revert to the previous commit; the conditional transitions are additive and the health timeout default only makes requests fail faster, so no data migration or two-phase deploy is required.

## Open Questions

- (none that would change the spec, approach, or task breakdown; the direct-IP fallback policy and the client-timeout value were resolved as decisions above.)
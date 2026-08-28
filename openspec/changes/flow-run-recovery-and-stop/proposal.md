## Why

A flow run whose finalization fails is left `running` forever, and the flow can never run again. On finalization failure `settleFlowRun` (in `apps/web/src/lib/flows/runner.ts`) swallowed the error and still called `releaseFlowLease`, which sets `leaseExpiresAt = null` on the flow while the run row stays `running`. Stale-run recovery (`recoverStaleRunningRuns`) only matches flows whose lease is *expired* (`leaseExpiresAt < now`), and in SQL `NULL < now` is not true — so a run orphaned behind a *released* lease is invisible to recovery. The `noActiveRun` guard then permanently blocks new runs of that flow: the only escape was manual DB surgery. Two coupled defects: recovery cannot see released-lease orphans, and finalization failure manufactures exactly that kind of orphan.

Operationally, a stuck run also had no user-facing remedy: the cancel endpoint exists (`POST /api/u/[slug]/flows/runs/[runId]/cancel`) but no UI surfaces it, so users could start runs they could never stop.

## What Changes

- Stale-run recovery (`apps/web/src/lib/services/flow-leases.ts`) matches flows whose lease is released (`leaseExpiresAt: null`) **or** expired, so orphaned `running` runs behind either state are recovered (`flow_run_stale_recovered`) on the next scheduler tick.
- `settleFlowRun` no longer releases the lease when `finalizeRun` fails: it logs the failure and returns early, preserving the run state and letting the lease expire so recovery — not a blind release — decides what happens to the run. This mirrors the existing `termination_unconfirmed` precedent.
- The flows UI surfaces stopping in three places — flows list page (Run button swaps to a destructive Stop button while the latest run is active), run history header (Stop replaces Run flow for the active run), and each running run card (Stop button) — all calling the existing cancel endpoint and refreshing after success.
- Stopping is offered for `running` and `waiting_for_human` runs; the run card keeps its permission check (execution user or admin) client-side while the API remains the authority.

## Capabilities

### New Capabilities
- `flow-run-lifecycle`: Behavioral contract for flow run lifecycle integrity — when a `running` run is recoverable, what finalization failure does to the lease, and how runs are stopped by users.

### Modified Capabilities
- (none — the existing `flow-execution` spec covers connector gating only; run lifecycle is currently unspecified.)

## Impact

- `apps/web/src/lib/services/flow-leases.ts` — `recoverStaleRunningRuns` where-clause gains the `leaseExpiresAt: null` arm.
- `apps/web/src/lib/flows/runner.ts` — `settleFlowRun` preserves the lease on finalization failure (logs, early return).
- `apps/web/src/components/flows/flows-page.tsx`, `flow-run-history-view.tsx`, `flow-run-history.tsx` — Stop buttons calling `cancelFlowRunRequest`.
- Tests: `src/lib/services/__tests__/flow.test.ts` (recovery matches NULL lease), existing flows component tests.
- No DB migration: both recovery arms query existing columns; no schema, config, or API contract change (cancel endpoint is reused as is).

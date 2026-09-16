## Context

See `proposal.md` — Why for the orphan mechanics.

Current mechanics that shape this design (verified in code):

- A flow claims a lease to run (`claimNextDueFlow`); the run moves through `running` → terminal states. `noActiveRun` refuses to start a run while the flow has one in `running`/`waiting_for_human`, so a stuck `running` row wedges the whole flow.
- Leases have two end states: *expired* (`leaseExpiresAt` in the past) and *released* (`releaseFlowLease` sets `leaseExpiresAt = null`, `leaseOwner = null`). Stale-run recovery only encoded the first.
- `settleFlowRun` already has a preserve-state precedent: the `termination_unconfirmed` outcome returns early without touching the lease, leaving the evidence in place for a later decision.
- `finalizeRun` performs the run-row transition (terminal status, steps, audit); if it throws, on main the `catch` fabricated a successful `{ retryScheduled: false }` result and the code proceeded to release the lease — decoupling the lease state from the run state.
- The cancel path is complete server-side (`cancel/route.ts`: capability + scope checks, `canCancelFlowRun`, audit event) but has no client invocation anywhere.

## Goals / Non-Goals

**Goals:**

- Every orphaned `running` run is eventually recovered by the scheduler, regardless of whether its flow lease was released or merely expired.
- Lease state never lies about run state: finalization failure must not release the lease.
- Users can stop an active run from the flows UI without API knowledge.

**Non-Goals:**

- Changing lease claim/expiry policy (`leaseMs`, renewal, ownership transfer) — only recovery's visibility and the failure path change.
- Mid-run cooperative cancellation (aborting an in-flight session prompt); the existing cancel endpoint marks the run cancelled, which the executor already respects at its next checkpoint.
- Recovering `waiting_for_human` runs automatically — a waiting run is intentionally parked, not stale; recovery continues to target `running` only.
- Backfilling or migrating existing orphaned rows beyond what the scheduler now recovers on its next tick.

## Decisions

### D1: Recovery matches released *or* expired leases

- `recoverStaleRunningRuns` where-clause becomes `flow: { OR: [{ leaseExpiresAt: null }, { leaseExpiresAt: { lt: now } }] }`. A released lease with a `running` run is by definition inconsistent (a run only releases its lease at settle time, after the run reaches a terminal state, or via the waiting handoff), so treating it as stale is safe.
- Alternative considered: treat `waiting_for_human` as recoverable after a timeout — rejected; waiting runs are user-interaction states with no lease-timeout semantics, and recovering them would cancel legitimate human steps.

### D2: Finalization failure preserves the lease (early return)

- On `finalizeRun` rejection, `settleFlowRun` logs with flow/run ids and returns without releasing. The lease then expires naturally, and recovery — which marks the run `failed` with `flow_run_stale_recovered` — is the single component that resolves the inconsistency.
- Alternative considered: retry finalization inline — rejected for this change; finalization failing repeatedly suggests a DB/runtime incident, and the recovery path is already the durable, scheduled remedy. The failed-finalization log keeps the cause discoverable.
- Consequence: run rows from failed finalizations linger in `running` until the next scheduler tick (normally seconds) instead of being silently released-and-lost. That visibility is the point.

### D3: Surface the existing cancel endpoint in the three flows surfaces

- Flows list page: when `permissions.canRun` and the latest run is `running`/`waiting_for_human`, the Run button swaps to a destructive outline Stop button; clicking cancels that run and reloads the list.
- Run history header: same active-run rule for the flow detail view; Stop replaces "Run flow" while a run is active.
- Run card: each `running` card shows a small Stop button gated by `executionUser` identity matching the viewing user (admins pass server-side regardless); `waiting_for_human` cards keep their human-response card with its own cancel affordance, so no second stop control is added there.
- All three call `cancelFlowRunRequest` (the existing typed client wrapper) and refresh from their own loader; the API remains the permission authority.

## Risks / Trade-offs

- [Recovery now fails runs whose lease is null for a *legitimate* transient reason] → No such path exists today: every release site is reached only after the run reached a terminal/waiting state, so a `running` row behind a null lease is already inconsistent. The recovery write also requires `status: running` and `retryScheduledFor: null`, keeping the blast radius narrow.
- [Preserved lease delays next run until expiry] → Bounded by the existing lease window (default lease `Ms` on claim); identical to the `termination_unconfirmed` behavior users already see, and strictly better than a permanently wedged flow.
- [Stop button shown for runs the user cannot cancel] → The API rejects with `forbidden`; the client surfaces the error string in the existing action-error slot. No new permission model client-side.

## Migration Plan

1. Single deploy; no schema change (both recovery arms use existing columns).
2. After deploy, the next scheduler tick recovers existing NULL-lease orphans; wedged flows become runnable again without manual intervention.
3. Rollback: revert the deploy. Runs recovered in the meantime stay failed (`flow_run_stale_recovered`), which is the truthful terminal state.

## Open Questions

- (none)

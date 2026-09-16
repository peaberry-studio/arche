## 1. Stale-run recovery

- [x] 1.1 In `apps/web/src/lib/services/flow-leases.ts`, extend the `recoverStaleRunningRuns` where-clause so flows with a released lease (`leaseExpiresAt: null`) or an expired lease (`leaseExpiresAt < now`) both qualify for recovery of their `running`, non-retried runs.
- [x] 1.2 Update `apps/web/src/lib/services/__tests__/flow.test.ts` to assert recovery's query matches the `null`-lease arm; keep the expired-lease arm asserted.

## 2. Lease preservation on finalization failure

- [x] 2.1 In `apps/web/src/lib/flows/runner.ts`, stop swallowing `finalizeRun` rejections: log the failure (flow id, run id, error) and return from `settleFlowRun` before the lease release, so the lease expires naturally and recovery resolves the run.

## 3. Stop controls in the flows UI

- [x] 3.1 `apps/web/src/components/flows/flows-page.tsx`: when the user can run the flow and its latest run is `running` or `waiting_for_human`, replace the Run button with a destructive Stop button that calls `cancelFlowRunRequest` and reloads the list on success.
- [x] 3.2 `apps/web/src/components/flows/flow-run-history-view.tsx`: while the flow has an active run (`running` or `waiting_for_human`), swap the "Run flow" header button for the Stop button wired to the same cancel call.
- [x] 3.3 `apps/web/src/components/flows/flow-run-history.tsx`: add a Stop button to `running` run cards for the execution user, keeping `waiting_for_human` cards on their existing human-response cancel affordance.
- [x] 3.4 Settle in-flight step records when a run is cancelled (`cancelRunByIdForScope`/`cancelRunById` in `apps/web/src/lib/services/flow-runs.ts`) and when stale runs are recovered (`recoverStaleRunningRuns` in `apps/web/src/lib/services/flow-leases.ts`) — the runner never revisits step rows after cancellation, so the run history spun on `running` steps forever after a stop. Verify with `src/lib/services/__tests__/flow.test.ts` cases: cancel settles `pending`/`running`/`waiting_for_human` steps with `flow_run_cancelled`, an already-settled run leaves steps untouched, and recovery settles orphaned steps in the same tick.
- [x] 3.5 Re-check active runs immediately before the destructive `instance/dispose` in `syncProviderAccessForInstance` (`apps/web/src/lib/opencode/providers.ts`): the deferral check runs before the auth PUTs, so a run registering during the sync was disposed mid-generation, surfacing as `MessageAbortedError` on fresh sessions (2026-09-02 13:37 incident). Auth writes still complete; only the dispose is skipped, deferring discovery reload to a later sync. Log dispose executions/skips and session-family abort targets for correlation. Verify with `src/lib/opencode/__tests__/providers.test.ts` cases: dispose skipped (warn logged, PUTs and sync state still recorded) when a run starts during the sync, dispose executes when none did.
- [x] 3.6 Keep the user on the flows list after starting a run (`flows-page.tsx`, `workspace-flows-view.tsx`): remove the `navigateToHistoryOnRun` redirect and silently re-fetch the list every 5s while any visible flow has an active run, without flashing the loading state; stop polling when no run is active. Verify with `src/components/flows/__tests__/flows-page.test.tsx`: in-place refresh, no navigation, no loader flash, poll teardown.
- [x] 3.7 After a dispose in `syncProviderAccessForInstance`, poll `/global/health` until it reports healthy (bounded 30s, 1s interval, 3s probe timeout) before returning — dispose exits the OpenCode process and callers immediately create sessions against it, producing deterministic empty `flow_no_assistant_output` responses after any >14-minute idle gap. Warn when the instance never reports healthy. Verify with `src/lib/opencode/__tests__/providers.test.ts`: health polling retries then succeeds, and the never-healthy path warns while still recording sync state.

## 4. Final verification

- [x] 4.1 Run flows service, runner, and component tests from `apps/web/` — green.
- [ ] 4.2 Run `bash scripts/check-podman-images.sh` from the repo root — images build.
- [x] 4.3 Run `openspec validate flow-run-recovery-and-stop --strict` — change validates.

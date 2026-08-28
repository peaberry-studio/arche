## 1. Stale-run recovery

- [x] 1.1 In `apps/web/src/lib/services/flow-leases.ts`, extend the `recoverStaleRunningRuns` where-clause so flows with a released lease (`leaseExpiresAt: null`) or an expired lease (`leaseExpiresAt < now`) both qualify for recovery of their `running`, non-retried runs.
- [x] 1.2 Update `apps/web/src/lib/services/__tests__/flow.test.ts` to assert recovery's query matches the `null`-lease arm; keep the expired-lease arm asserted.

## 2. Lease preservation on finalization failure

- [x] 2.1 In `apps/web/src/lib/flows/runner.ts`, stop swallowing `finalizeRun` rejections: log the failure (flow id, run id, error) and return from `settleFlowRun` before the lease release, so the lease expires naturally and recovery resolves the run.

## 3. Stop controls in the flows UI

- [x] 3.1 `apps/web/src/components/flows/flows-page.tsx`: when the user can run the flow and its latest run is `running` or `waiting_for_human`, replace the Run button with a destructive Stop button that calls `cancelFlowRunRequest` and reloads the list on success.
- [x] 3.2 `apps/web/src/components/flows/flow-run-history-view.tsx`: while the flow has an active run (`running` or `waiting_for_human`), swap the "Run flow" header button for the Stop button wired to the same cancel call.
- [x] 3.3 `apps/web/src/components/flows/flow-run-history.tsx`: add a Stop button to `running` run cards for the execution user, keeping `waiting_for_human` cards on their existing human-response cancel affordance.

## 4. Final verification

- [x] 4.1 Run flows service, runner, and component tests from `apps/web/` — green.
- [ ] 4.2 Run `bash scripts/check-podman-images.sh` from the repo root — images build.
- [x] 4.3 Run `openspec validate flow-run-recovery-and-stop --strict` — change validates.

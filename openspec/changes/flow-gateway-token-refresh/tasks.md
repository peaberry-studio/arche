## 1. Forced refresh at flow start

- [x] 1.1 Add `force?: boolean` to `ensureProviderAccessFreshForExecution` in `apps/web/src/lib/opencode/providers.ts`: when set, skip the freshness-age early return for a running instance while keeping the provider-sync lock, the credential-hash check, and the active-run deferral. Verify with `src/lib/opencode/__tests__/providers.test.ts` cases: forced refresh runs despite a fresh matching sync record; a forced refresh still defers while the workspace has active runs.
- [x] 1.2 Add `options: { forceProviderRefresh?: boolean }` to `ensureWorkspaceRunningForExecution` in `apps/web/src/lib/opencode/session-execution.ts` and honor it only on the already-running path (a freshly started workspace was just synced). Verify with a `src/lib/opencode/__tests__/session-execution.test.ts` case asserting the flag is threaded through as `force: true`.
- [x] 1.3 Pass `{ forceProviderRefresh: true }` from both flow entry points in `apps/web/src/lib/flows/runner.ts` (`executeClaimedFlowRun` and `resumeClaimedFlowRun`). Verify with updated `runner.test.ts` assertions for scheduled/manual and resumed runs.

## 2. Step-boundary refresh

- [x] 2.1 In `executeFlowNodes` in `apps/web/src/lib/flows/runner.ts`, call `ensureProviderAccessFreshForExecution` before each node executes, after the cancellation and lease checks; catch and warn on failure without failing the run. Verify with `runner.test.ts` cases: one refresh per node in a two-node flow, and the run still succeeds when the refresh rejects.
- [x] 2.2 Force the boundary refresh (`force: true`) except on the first loop iteration, which the entry-point refresh already covers. A threshold-based boundary check skips while the sync is young and cannot keep multi-minute steps inside the token TTL (2026-09-02 incident: an 11-minute step failed at expiry after two skipped boundaries). Verify with updated `runner.test.ts` cases: the boundary call carries `force: true`, a single-node flow makes no boundary call, and the run still succeeds when the forced refresh rejects.

## 3. Retryable gateway auth failures

- [x] 3.1 Add `invalid_token` to `isRetryableFlowRunError` in `apps/web/src/lib/flows/retry-policy.ts`. Verify with a `retry-policy.test.ts` case covering the surfaced `APIError: Unauthorized: invalid_token` text.

## Why

Multi-step flows fail mid-run with `APIError: Unauthorized: invalid_token` from the internal provider gateway. The flow runner syncs provider access exactly once, before the flow starts (`ensureWorkspaceRunningForExecution` in `apps/web/src/lib/flows/runner.ts`), and gateway tokens carry a short TTL (`ARCHE_GATEWAY_TOKEN_TTL_SECONDS`, default 900s). Two runs of the same Codebase Hunter flow on 2026-08-31 failed this way:

- A 17-minute run whose token was issued at flow start expired between steps; the next step's first gateway call was rejected.
- A run that started 7 minutes after an interactive workspace visit: `shouldRefreshProviderAccess` saw a "fresh" sync (under the TTL-minus-skew threshold), skipped re-syncing, and the flow inherited a partially aged token that expired mid-run.

During flow execution tokens are never refreshed: the runner makes no further refresh calls, and `ensureProviderAccessFreshForExecution` defers while any run is active — including the flow's own runs, so a naive between-step refresh from inside a step would defer forever (and disposing the instance mid-generation aborts it). Worse, `invalid_token` is absent from `isRetryableFlowRunError`, so an expiry is a terminal run failure even though the retry machinery resumes from the failed node and would re-sync on the retry.

## What Changes

- Force a provider-access refresh at flow start: `ensureProviderAccessFreshForExecution` gains a `force` flag that bypasses the freshness-age skip (credential-hash check and active-run deferral still apply), and the flow runner requests it via `ensureWorkspaceRunningForExecution(slug, userId, { forceProviderRefresh: true })` on both entry points (claimed runs and resumes). A flow therefore starts with a token valid for the full TTL window.
- Refresh provider access at every flow step boundary in `executeFlowNodes`, before each node executes. At a boundary the flow's own message run is finalized, so the active-run deferral only fires for unrelated runs — exactly the case where a concurrent sync (which disposes the OpenCode instance) must not abort in-flight generation. A failed boundary refresh logs a warning and does not fail the run; genuine auth failures still surface from the step itself.
- Classify gateway token expiry (`invalid_token`) as retryable in `isRetryableFlowRunError`, so an expiry that survives the above costs one step re-run after backoff instead of failing the run; the retry re-syncs provider access and resumes from `run.currentNodeId`.

## Non-goals

- No mid-flight (mid-step) token refresh. `syncProviderAccessForInstance` already supports `disposeInstance: false`, but this only helps if the OpenCode instance re-reads auth keys per request instead of caching them at provider creation. Follow-up change once verified against a live instance; would hook into the existing session-executor pulse.
- No change to token TTL, token claims, or token issuance. Tokens stay short-lived and scoped per user, workspace, provider, and credential version.
- No per-provider partial syncs; refresh keeps the existing sync-all-providers behavior.

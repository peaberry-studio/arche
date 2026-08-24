## Why

Workspace startup can hang indefinitely and then destroy a working container:

1. **Blocking healthcheck**: `isInstanceHealthyWithPassword()` issues a `fetch()` to `/global/health` with no per-request timeout or `AbortSignal`. In production a hanging request waited on Undici's internal timeout (~5 min) even though OpenCode was already listening. Because `waitForHealthy()` waits on the direct IP and then the DNS host sequentially, a single hanging request blocks the whole startup, and its deadline is only checked between loop iterations — so it is not bounded even by `ARCHE_START_TIMEOUT_MS`. `ensureInstanceRunningAction()` does not return while this is alive, so the client never activates its own polling/timeout.
2. **Startup race**: while the first request is still blocked, a second query sees the container healthy and flips the instance from `starting` to `running` via `getInstanceStatus()`/`correctToRunning()`. When the first request finally fails, its cleanup (`stopContainer` + `removeContainer` + `setError(slug)`) is unconditional by slug, so it destroys the container the other flow already confirmed as working. This is the observed production behavior: reload opens the workspace, but the original in-flight request later shuts it down.

The goal is to bound every health check, make the total startup honor its deadline, and make state transitions and cleanup safe against concurrent attempts.

## What Changes

- Bound each `/global/health` request with a per-request timeout (via `AbortSignal`) so no single health check can outlive its deadline.
- Keep `ARCHE_START_TIMEOUT_MS` as the total startup budget and ensure no individual request exceeds the remaining time.
- Stop blocking the startup cycle on a direct-IP health check: check DNS and direct IP so one cannot stall the other, and cancel the losing request when one confirms health.
- Make instance state transitions conditional on the attempt's `containerId` so an old request can no longer mutate or delete the outcome of a newer one:
  - `setRunningIfCurrentContainer`, `setErrorIfCurrentContainer`, and optionally `correctToRunningIfCurrentContainer`.
  - On failure, only stop/remove the container when the attempt still owns it; otherwise re-read and return the current state.
- Stop publishing `running` prematurely: `getInstanceStatus()` must keep a recent `starting` attempt as `starting` even when the process answers the health check. `running` is only published after the startup flow completes health check + provider sync. Add an explicit reconciliation route to recover an interrupted startup.
- Add an independent frontend timeout in `use-instance-startup` that is armed before awaiting the server action, so a blocked server action/proxy/network can no longer leave the UI showing "Starting workspace" indefinitely, and a late response cannot overwrite a timed-out error.

## Capabilities

### New Capabilities
- `workspace-startup`: Behavioral rules for the instance startup lifecycle — bounded health checks, total-startup deadline enforcement, DNS/direct-IP probing, race-safe state transitions keyed by `containerId`, and when `running` may be published. Covers the spawner core, the OpenCode health client, the instance service transitions, and the frontend startup hook.

### Modified Capabilities
- (none — this is the first capability under the repo's `openspec/specs/` tree.)

## Impact

- `apps/web/src/lib/opencode/client.ts` — `isInstanceHealthyWithPassword()` gains a per-request timeout; new `healthcheck_timeout` result.
- `apps/web/src/lib/spawner/core.ts` — `waitForHealthy()` bounded, non-blocking direct-IP/DNS probing; `startInstance()` uses conditional transitions and guarded cleanup; `getInstanceStatus()` stops premature `running`.
- `apps/web/src/lib/services/instance.ts` — conditional transitions keyed by `slug + status + containerId`.
- `apps/web/src/hooks/use-instance-startup.ts` — independent client-side timeout that arms before the server action resolves.
- New and updated tests in `src/lib/spawner/__tests__/core.test.ts`, `src/lib/opencode/__tests__/client.test.ts`, and `src/hooks/__tests__/use-instance-startup.test.tsx`.
- No DB migration: `containerId` already exists and is unique per container creation.
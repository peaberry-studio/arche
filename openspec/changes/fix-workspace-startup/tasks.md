## 1. Bounded health check client

- [ ] 1.1 Add an optional `{ timeoutMs }` option to `isInstanceHealthyWithPassword()` in `apps/web/src/lib/opencode/client.ts`, creating an `AbortController` per `/health` request and aborting on deadline. Default timeout ~5s. Verify: add a unit test in `src/lib/opencode/__tests__/client.test.ts` where a never-resolving `fetch` is aborted via the signal and returns `{ ok: false, detail: 'healthcheck_timeout' }` with no dangling promise.
- [ ] 1.2 Map an abort (and the expired deadline) to the stable `healthcheck_timeout` result, keeping existing DNS/ECONNREFUSED/http-status/invalid-json detail mapping. Verify: existing `client.test.ts` cases still pass and the new timeout case returns `healthcheck_timeout`.

## 2. Instance service conditional transitions

- [ ] 2.1 Add `setRunningIfCurrentContainer(slug, containerId, configSha)` to `src/lib/services/instance.ts` using `updateMany` guarded by `{ slug, status: 'starting', containerId }`, returning the affected count. Verify: a focused unit test asserts the compound `where` and that a mismatched `containerId` yields zero affected rows.
- [ ] 2.2 Add `setErrorIfCurrentContainer(slug, containerId)` and `correctToRunningIfCurrentContainer(slug, containerId)` with the same guard shape. Verify: unit tests assert the `where` clause and affected-row semantics.

## 3. Spawner core startup changes

- [ ] 3.1 Rework `waitForHealthy()` in `src/lib/spawner/core.ts` so each probe uses `min(perAttemptTimeoutMs, remainingBudgetMs)` and the loop honors `ARCHE_START_TIMEOUT_MS` as a hard total; direct-IP and DNS probes must not block each other (bounded sequential, with optional parallel + cancel). Verify: the new core tests in `src/lib/spawner/__tests__/core.test.ts` cover "direct IP blocked, DNS healthy" and "no health check responds" with a shortened `ARCHE_START_TIMEOUT_MS`.
- [ ] 3.2 Capture the attempt's `containerId` in `startInstance()` and guard the failure/cleanup paths: run `setErrorIfCurrentContainer` first, then `stopContainer`/`removeContainer` only if the transition affected rows or the current DB `containerId` differs from the attempt's own; otherwise re-read and return the current state. Verify: new race tests assert no `stopContainer`/`removeContainer`/`setError` when another flow confirmed `running`, and no removal of the current `containerId` when a newer attempt owns it.
- [ ] 3.3 On the success path, mark `running` only via `setRunningIfCurrentContainer`; if it affects zero rows, re-read and return the current status without a duplicate audit event. Verify: tests assert `running` is published only after the container is still current.
- [ ] 3.4 Stop `getInstanceStatus()` from flipping a recent `starting` instance to `running` on health alone; keep returning `starting`. Verify: the `'corrects healthy starting instances to running'` core test is re-specified so a fresh `starting` instance returns `starting`.

## 4. Reconciliation route for interrupted startups

- [ ] 4.1 Add a reconciliation path that, for a `starting` instance whose attempt is no longer fresh, verifies the container, runs a bounded health check, syncs providers, and calls `correctToRunningIfCurrentContainer`. Wire it so status reads trigger it when the attempt is stale. Verify: a core test drives an interrupted `starting` instance through reconciliation to `running` when container, health, and provider sync all succeed.
- [ ] 4.2 Ensure the reconciliation never publishes `running` before provider sync completes. Verify: a test asserts reconciliation leaves a syncing failure in `starting` (or the prior state) rather than `running`.

## 5. Frontend startup timeout

- [ ] 5.1 In `use-instance-startup.ts`, set the attempt to `starting` and arm the timeout before awaiting the server action, tag the attempt with a local id, and on timeout surface the error and ignore a late response for that attempt. Set the client timeout to `ARCHE_START_TIMEOUT_MS` plus a margin so the client does not time out before a legitimately finishing server. Verify: `src/hooks/__tests__/use-instance-startup.test.tsx` renders with a pending `ensureInstanceRunningAction`, enters `starting`, advances past the timeout, and asserts a late resolve does not overwrite the error.

## 6. Test suite and lint

- [ ] 6.1 Add regression tests for the incident scenarios (blocking direct-IP probe, total-deadline timeout, race with a second flow confirming `running`, a stale attempt not affecting a newer container). Verify: run `pnpm test` from `apps/web/` and confirm the new tests pass and pre-fix versions of the client/core/hook tests fail against the current code.
- [ ] 6.2 Update existing mocks in `core.test.ts` for the new conditional service methods and any changed call signatures, and confirm the full suite passes. Verify: `pnpm test` and `pnpm lint` from `apps/web/` both pass.
- [ ] 6.3 Build the workspace image locally to confirm no container-layer regressions. Verify: `bash scripts/check-podman-images.sh` from the repo root reports success.
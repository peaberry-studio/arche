## Why

The `sessions-panel` test "groups sessions by date buckets" broke in CI on 2026-08-31 (and fails locally on the same date) with no code change: its "old" fixture is `Date.now() - 30 days`, and `groupByDateBucket` has a "This month" tier, so whenever `now - 30 days` is still inside the current calendar month — every 31st — the fixture groups as "This month" and the `Older` header never renders. The test depends on the wall calendar instead of being deterministic.

## What Changes

- Pin the clock in that single test with `vi.useFakeTimers()` / `vi.setSystemTime()` at a fixed mid-month instant (2026-06-17T12:00Z) so the three fixtures deterministically land in Today, Yesterday, and Older; restore real timers in a `finally`.
- No product, library, or spec-level behavior changes — test-only, so the change opts out of specs (`skip_specs: true`).

## Capabilities

### New Capabilities
- (none — no behavior changes.)

### Modified Capabilities
- (none.)

## Impact

- `apps/web/src/components/workspace/__tests__/sessions-panel.test.tsx` — one test made calendar-independent.
- Verified the test passes under `UTC`, `Pacific/Kiritimati` (UTC+14), and `America/New_York`, and on the failure-prone date; suite-wide behavior unchanged.

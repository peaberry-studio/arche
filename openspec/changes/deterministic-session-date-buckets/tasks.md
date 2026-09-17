## 1. Deterministic test

- [x] 1.1 In `apps/web/src/components/workspace/__tests__/sessions-panel.test.tsx`, pin the clock for "groups sessions by date buckets" via `vi.useFakeTimers()` + `vi.setSystemTime()` (2026-06-17T12:00:00Z), keeping render inside the fake-clock scope and restoring real timers in `finally`.

## 2. Verification

- [x] 2.1 Run the file under `UTC`, `Pacific/Kiritimati` (UTC+14), and `America/New_York` — passes in all.
- [x] 2.2 Run the sessions-panel and lib test files — green.
- [ ] 2.3 Run `bash scripts/check-podman-images.sh` from the repo root — unaffected by this change.

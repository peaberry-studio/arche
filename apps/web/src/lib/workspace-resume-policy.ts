export const RESUME_MAX_FAILURES = 2
export const RESUME_COOLDOWN_MS = 2 * 60 * 1000

export type ResumeFailureState = {
  failures: number
  lastFailureAt: number
  suppressed: boolean
}

export function canAutoResume(
  state: ResumeFailureState | undefined,
  now: number,
): boolean {
  if (!state) return true
  if (!state.suppressed) return true
  return now - state.lastFailureAt >= RESUME_COOLDOWN_MS
}

export function recordResumeFailure(
  state: ResumeFailureState | undefined,
  now: number,
): ResumeFailureState {
  const failures = (state?.failures ?? 0) + 1
  return {
    failures,
    lastFailureAt: now,
    suppressed: failures >= RESUME_MAX_FAILURES,
  }
}

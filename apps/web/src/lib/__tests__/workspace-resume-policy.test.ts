import { describe, expect, it } from 'vitest'

import {
  canAutoResume,
  recordResumeFailure,
  RESUME_COOLDOWN_MS,
  RESUME_MAX_FAILURES,
} from '@/lib/workspace-resume-policy'

describe('workspace resume policy', () => {
  it('suppresses retries after max failures', () => {
    const now = Date.now()
    const first = recordResumeFailure(undefined, now)
    const second = recordResumeFailure(first, now + 1)

    expect(first.failures).toBe(1)
    expect(first.suppressed).toBe(false)
    expect(second.failures).toBe(RESUME_MAX_FAILURES)
    expect(second.suppressed).toBe(true)
  })

  it('blocks resume during cooldown and allows after cooldown', () => {
    const now = Date.now()
    const suppressed = recordResumeFailure(recordResumeFailure(undefined, now), now + 1)

    expect(canAutoResume(suppressed, now + RESUME_COOLDOWN_MS - 1)).toBe(false)
    expect(canAutoResume(suppressed, now + RESUME_COOLDOWN_MS + 1)).toBe(true)
  })
})

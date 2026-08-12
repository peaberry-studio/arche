import { describe, expect, it } from 'vitest'

import { getTerminalRetryError } from '@/lib/opencode/retry-state'

describe('getTerminalRetryError', () => {
  it('identifies free tier limit retries as terminal', () => {
    expect(getTerminalRetryError({
      type: 'retry',
      action: { reason: 'free_tier_limit' },
    })).toBe('free_tier_limit')
  })

  it('keeps ordinary retries recoverable', () => {
    expect(getTerminalRetryError({
      type: 'retry',
      action: { reason: 'temporary_failure' },
    })).toBeNull()
  })
})

import { describe, expect, it } from 'vitest'

import { formatBadgePercentage } from '../../../scripts/update-coverage-badges.mjs'

describe('update coverage badges', () => {
  it('truncates coverage to whole percentages', () => {
    expect(formatBadgePercentage(60.249)).toBe('60%')
    expect(formatBadgePercentage(60.999)).toBe('60%')
  })

  it('preserves exact whole percentages', () => {
    expect(formatBadgePercentage(60)).toBe('60%')
    expect(formatBadgePercentage(100)).toBe('100%')
  })
})

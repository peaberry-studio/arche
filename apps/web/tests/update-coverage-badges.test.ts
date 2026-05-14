import { describe, expect, it } from 'vitest'

import { formatBadgePercentage } from '../../../scripts/update-coverage-badges.mjs'

describe('update coverage badges', () => {
  it('truncates coverage to two decimals instead of rounding it', () => {
    expect(formatBadgePercentage(60.249)).toBe('60.24%')
    expect(formatBadgePercentage(60.999)).toBe('60.99%')
  })

  it('preserves exact whole percentages', () => {
    expect(formatBadgePercentage(60)).toBe('60%')
    expect(formatBadgePercentage(49.54)).toBe('49.54%')
    expect(formatBadgePercentage(15.71)).toBe('15.71%')
  })
})

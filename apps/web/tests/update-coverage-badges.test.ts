import { describe, expect, it } from 'vitest'

import { formatBadgePercentage } from '../../../scripts/update-coverage-badges.mjs'

describe('update coverage badges', () => {
  it('truncates coverage to one decimal place instead of rounding it', () => {
    expect(formatBadgePercentage(60.24)).toBe('60.2%')
    expect(formatBadgePercentage(60.25)).toBe('60.2%')
  })

  it('preserves exact one-decimal percentages', () => {
    expect(formatBadgePercentage(60.3)).toBe('60.3%')
    expect(formatBadgePercentage(49.54)).toBe('49.5%')
    expect(formatBadgePercentage(15.71)).toBe('15.7%')
  })
})

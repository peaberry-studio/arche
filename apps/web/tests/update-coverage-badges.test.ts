import { describe, expect, it } from 'vitest'

import { formatBadgePercentage } from '../../../scripts/update-coverage-badges.mjs'

describe('update coverage badges', () => {
  it('truncates coverage to whole percentages instead of rounding it', () => {
    expect(formatBadgePercentage(60.24)).toBe('60%')
    expect(formatBadgePercentage(60.99)).toBe('60%')
  })

  it('preserves exact whole percentages', () => {
    expect(formatBadgePercentage(60)).toBe('60%')
    expect(formatBadgePercentage(49.54)).toBe('49%')
    expect(formatBadgePercentage(15.71)).toBe('15%')
  })
})

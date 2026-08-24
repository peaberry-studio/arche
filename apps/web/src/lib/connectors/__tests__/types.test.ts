import { describe, expect, it } from 'vitest'

import { isSingleInstanceConnectorType } from '../types'

describe('connector types', () => {
  it('isSingleInstanceConnectorType returns true for single-instance types', () => {
    expect(isSingleInstanceConnectorType('linear')).toBe(true)
    expect(isSingleInstanceConnectorType('google_drive')).toBe(true)
    expect(isSingleInstanceConnectorType('github')).toBe(true)
  })

  it('isSingleInstanceConnectorType returns false for multi-instance types', () => {
    expect(isSingleInstanceConnectorType('custom')).toBe(false)
  })
})

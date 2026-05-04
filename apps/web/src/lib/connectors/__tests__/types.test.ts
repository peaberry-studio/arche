import { describe, expect, it } from 'vitest'

import { isConnectorType, isSingleInstanceConnectorType } from '../types'

describe('connector types', () => {
  it('isConnectorType returns true for known types', () => {
    expect(isConnectorType('linear')).toBe(true)
    expect(isConnectorType('notion')).toBe(true)
    expect(isConnectorType('custom')).toBe(true)
  })

  it('isConnectorType returns false for unknown types', () => {
    expect(isConnectorType('unknown')).toBe(false)
    expect(isConnectorType('')).toBe(false)
  })

  it('isSingleInstanceConnectorType returns true for single-instance types', () => {
    expect(isSingleInstanceConnectorType('linear')).toBe(true)
    expect(isSingleInstanceConnectorType('google_drive')).toBe(true)
  })

  it('isSingleInstanceConnectorType returns false for multi-instance types', () => {
    expect(isSingleInstanceConnectorType('custom')).toBe(false)
  })
})

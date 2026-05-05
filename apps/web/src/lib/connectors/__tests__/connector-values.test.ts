import { describe, expect, it } from 'vitest'

import {
  getBoolean,
  getFiniteNumber,
  getNonNegativeInteger,
  getPositiveInteger,
  getString,
  getStringArray,
  hasOwnProperty,
  isRecord,
  isStringArray,
} from '../connector-values'

describe('connector value helpers', () => {
  it('detects records without accepting arrays or nullish values', () => {
    expect(isRecord({ key: 'value' })).toBe(true)
    expect(isRecord([])).toBe(false)
    expect(isRecord(null)).toBe(false)
    expect(isRecord('value')).toBe(false)
  })

  it('normalizes primitive connector values', () => {
    expect(getString('  token  ')).toBe('token')
    expect(getString('   ')).toBeUndefined()
    expect(getFiniteNumber(3.5)).toBe(3.5)
    expect(getFiniteNumber(Number.POSITIVE_INFINITY)).toBeUndefined()
    expect(getBoolean(false)).toBe(false)
    expect(getBoolean('false')).toBeUndefined()
  })

  it('validates integer connector values', () => {
    expect(getPositiveInteger(1)).toBe(1)
    expect(getPositiveInteger(0)).toBeUndefined()
    expect(getPositiveInteger(1.5)).toBeUndefined()
    expect(getNonNegativeInteger(0)).toBe(0)
    expect(getNonNegativeInteger(-1)).toBeUndefined()
    expect(getNonNegativeInteger(2.2)).toBeUndefined()
  })

  it('normalizes and validates string arrays', () => {
    expect(getStringArray([' alpha ', '', 3, 'beta'])).toEqual(['alpha', 'beta'])
    expect(getStringArray(['  '])).toBeUndefined()
    expect(getStringArray('alpha')).toBeUndefined()
    expect(isStringArray(['a', 'b'])).toBe(true)
    expect(isStringArray(['a', 1])).toBe(false)
  })

  it('checks direct ownership without matching inherited properties', () => {
    const parent = { inherited: true }
    const child: Record<string, unknown> = Object.create(parent)
    child.own = true

    expect(hasOwnProperty(child, 'own')).toBe(true)
    expect(hasOwnProperty(child, 'inherited')).toBe(false)
  })
})

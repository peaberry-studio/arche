import { describe, it, expect } from 'vitest'
import { validatePassword, MIN_PASSWORD_LENGTH } from '../password'

describe('validatePassword', () => {
  it('returns valid for a password meeting minimum length', () => {
    expect(validatePassword('password123')).toEqual({ valid: true })
  })

  it('returns invalid for empty password', () => {
    expect(validatePassword('')).toEqual({ valid: false, message: 'Password is required.' })
  })

  it('returns invalid for password shorter than minimum length', () => {
    expect(validatePassword('short')).toEqual({
      valid: false,
      message: `Password must be at least ${MIN_PASSWORD_LENGTH} characters.`,
    })
  })

  it('returns valid for password exactly at minimum length', () => {
    expect(validatePassword('a'.repeat(MIN_PASSWORD_LENGTH))).toEqual({ valid: true })
  })
})

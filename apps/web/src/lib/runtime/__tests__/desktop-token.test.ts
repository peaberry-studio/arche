import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { randomBytes } from 'node:crypto'

import {
  DESKTOP_TOKEN_HEADER,
  getDesktopToken,
  validateDesktopToken,
} from '../desktop/token'

function generateTestToken(): string {
  return randomBytes(32).toString('base64url')
}

describe('desktop token', () => {
  const originalEnv = process.env

  beforeEach(() => {
    process.env = { ...originalEnv }
  })

  afterEach(() => {
    process.env = originalEnv
  })

  describe('getDesktopToken', () => {
    it('returns null when env var is not set', () => {
      delete process.env.ARCHE_DESKTOP_API_TOKEN
      expect(getDesktopToken()).toBeNull()
    })

    it('returns null when env var is empty', () => {
      process.env.ARCHE_DESKTOP_API_TOKEN = ''
      expect(getDesktopToken()).toBeNull()
    })

    it('returns the token when set', () => {
      process.env.ARCHE_DESKTOP_API_TOKEN = 'test-token-123'
      expect(getDesktopToken()).toBe('test-token-123')
    })
  })

  describe('validateDesktopToken', () => {
    it('returns false when no expected token is configured', () => {
      delete process.env.ARCHE_DESKTOP_API_TOKEN
      expect(validateDesktopToken('any-token')).toBe(false)
    })

    it('returns false when candidate is null', () => {
      process.env.ARCHE_DESKTOP_API_TOKEN = 'expected-token'
      expect(validateDesktopToken(null)).toBe(false)
    })

    it('returns false when candidate is empty', () => {
      process.env.ARCHE_DESKTOP_API_TOKEN = 'expected-token'
      expect(validateDesktopToken('')).toBe(false)
    })

    it('returns false when candidate does not match', () => {
      process.env.ARCHE_DESKTOP_API_TOKEN = 'correct-token'
      expect(validateDesktopToken('wrong-token')).toBe(false)
    })

    it('returns false when candidate has different length', () => {
      process.env.ARCHE_DESKTOP_API_TOKEN = 'short'
      expect(validateDesktopToken('much-longer-token')).toBe(false)
    })

    it('returns true when candidate matches expected token', () => {
      const token = generateTestToken()
      process.env.ARCHE_DESKTOP_API_TOKEN = token
      expect(validateDesktopToken(token)).toBe(true)
    })
  })

  describe('DESKTOP_TOKEN_HEADER', () => {
    it('is a lowercase header name', () => {
      expect(DESKTOP_TOKEN_HEADER).toBe('x-arche-desktop-token')
    })
  })
})

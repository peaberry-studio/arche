import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { getSessionPepper, hashSessionToken, newSessionToken } from '../security'

describe('security', () => {
  const originalEnv = process.env

  beforeEach(() => {
    process.env = { ...originalEnv }
    delete process.env.ARCHE_SESSION_PEPPER
    delete process.env.NODE_ENV
  })

  afterEach(() => {
    process.env = originalEnv
  })

  describe('getSessionPepper', () => {
    it('returns the env var when set', () => {
      process.env.ARCHE_SESSION_PEPPER = 'my-secret-pepper'
      expect(getSessionPepper()).toBe('my-secret-pepper')
    })

    it('throws in production when env var is missing', () => {
      process.env.NODE_ENV = 'production'
      expect(() => getSessionPepper()).toThrow('ARCHE_SESSION_PEPPER is required in production')
    })

    it('falls back to a dev pepper in non-production and logs a warning', () => {
      process.env.NODE_ENV = 'development'
      const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})
      expect(getSessionPepper()).toBe('dev-insecure-pepper')
      expect(warnSpy).toHaveBeenCalledWith(
        '[security] Using insecure development secret for session pepper. Set ARCHE_SESSION_PEPPER env var.',
      )
      warnSpy.mockRestore()
    })
  })

  describe('hashSessionToken', () => {
    it('produces a deterministic sha256 hex hash', () => {
      process.env.ARCHE_SESSION_PEPPER = 'pepper'
      const hash1 = hashSessionToken('token-abc')
      const hash2 = hashSessionToken('token-abc')
      expect(hash1).toBe(hash2)
      expect(hash1).toMatch(/^[a-f0-9]{64}$/)
    })

    it('produces different hashes for different tokens', () => {
      process.env.ARCHE_SESSION_PEPPER = 'pepper'
      const hash1 = hashSessionToken('token-a')
      const hash2 = hashSessionToken('token-b')
      expect(hash1).not.toBe(hash2)
    })
  })

  describe('newSessionToken', () => {
    it('generates a base64url string of expected length', () => {
      const token = newSessionToken()
      expect(token).toMatch(/^[A-Za-z0-9_-]+$/)
      expect(Buffer.from(token, 'base64url').length).toBe(32)
    })

    it('generates unique tokens on successive calls', () => {
      const t1 = newSessionToken()
      const t2 = newSessionToken()
      expect(t1).not.toBe(t2)
    })
  })
})

import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import {
  generatePat,
  generatePatSalt,
  hasPatPrefix,
  hashPat,
  hashPatLookup,
  PAT_PREFIX,
  verifyPat,
} from '../pat'

describe('PAT crypto', () => {
  const originalPepper = process.env.ARCHE_SESSION_PEPPER

  beforeEach(() => {
    process.env.ARCHE_SESSION_PEPPER = 'test-session-pepper'
  })

  afterEach(() => {
    if (originalPepper === undefined) {
      delete process.env.ARCHE_SESSION_PEPPER
      return
    }

    process.env.ARCHE_SESSION_PEPPER = originalPepper
  })

  describe('generatePat', () => {
    it('returns a token starting with the arche_pat_ prefix', () => {
      const token = generatePat()
      expect(token.startsWith(PAT_PREFIX)).toBe(true)
    })

    it('generates unique tokens each call', () => {
      const a = generatePat()
      const b = generatePat()
      expect(a).not.toBe(b)
    })

    it('generates a token with a 32-byte hex body after the prefix', () => {
      const token = generatePat()
      const body = token.slice(PAT_PREFIX.length)
      expect(body).toMatch(/^[0-9a-f]{64}$/)
    })
  })

  describe('hasPatPrefix', () => {
    it('returns true for PATs', () => {
      expect(hasPatPrefix(generatePat())).toBe(true)
    })

    it('returns false for non-PAT strings', () => {
      expect(hasPatPrefix('session_abc')).toBe(false)
    })
  })

  describe('generatePatSalt', () => {
    it('returns a hex salt', () => {
      expect(generatePatSalt()).toMatch(/^[0-9a-f]{32}$/)
    })

    it('generates unique salts', () => {
      expect(generatePatSalt()).not.toBe(generatePatSalt())
    })
  })

  describe('hashPatLookup', () => {
    it('returns a hex string', () => {
      expect(hashPatLookup('arche_pat_test123')).toMatch(/^[0-9a-f]{64}$/)
    })

    it('is deterministic', () => {
      const token = generatePat()
      expect(hashPatLookup(token)).toBe(hashPatLookup(token))
    })

    it('produces different hashes for different tokens', () => {
      expect(hashPatLookup(generatePat())).not.toBe(hashPatLookup(generatePat()))
    })
  })

  describe('hashPat', () => {
    it('returns a hex string', () => {
      expect(hashPat('arche_pat_test123', 'a'.repeat(32))).toMatch(/^[0-9a-f]{64}$/)
    })

    it('is deterministic for the same token and salt', () => {
      const token = generatePat()
      const salt = generatePatSalt()
      expect(hashPat(token, salt)).toBe(hashPat(token, salt))
    })

    it('changes when the salt changes', () => {
      const token = generatePat()
      expect(hashPat(token, 'a'.repeat(32))).not.toBe(hashPat(token, 'b'.repeat(32)))
    })
  })

  describe('verifyPat', () => {
    it('returns true for matching token, salt, and hash', () => {
      const token = generatePat()
      const salt = generatePatSalt()
      const hash = hashPat(token, salt)

      expect(verifyPat(token, salt, hash)).toBe(true)
    })

    it('returns false for a non-matching token', () => {
      const salt = generatePatSalt()
      const hash = hashPat(generatePat(), salt)

      expect(verifyPat(generatePat(), salt, hash)).toBe(false)
    })

    it('returns false when the stored hash has an unexpected length', () => {
      expect(verifyPat(generatePat(), generatePatSalt(), 'a'.repeat(63))).toBe(false)
    })
  })
})

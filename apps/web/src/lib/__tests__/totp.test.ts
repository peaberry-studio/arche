import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('../spawner/config', () => ({
  getEncryptionKey: () => Buffer.from('0'.repeat(64), 'hex'),
}))

describe('totp', () => {
  let totp: typeof import('../totp')

  beforeEach(async () => {
    vi.resetModules()
    totp = await import('../totp')
  })

  describe('generateSecret', () => {
    it('returns a base32-encoded secret', () => {
      const secret = totp.generateSecret()
      expect(secret).toMatch(/^[A-Z2-7]+$/)
      expect(secret.length).toBeGreaterThanOrEqual(26)
    })

    it('generates unique secrets', () => {
      expect(totp.generateSecret()).not.toBe(totp.generateSecret())
    })
  })

  describe('encryptSecret / decryptSecret', () => {
    it('round-trips a secret', () => {
      const original = totp.generateSecret()
      const encrypted = totp.encryptSecret(original)
      expect(totp.decryptSecret(encrypted)).toBe(original)
    })

    it('produces different ciphertext each time', () => {
      const secret = totp.generateSecret()
      expect(totp.encryptSecret(secret)).not.toBe(totp.encryptSecret(secret))
    })
  })

  describe('generateTotpUri', () => {
    it('returns an otpauth URI', () => {
      const uri = totp.generateTotpUri({ secret: 'JBSWY3DPEHPK3PXP', email: 'user@example.com', issuer: 'Arche' })
      expect(uri).toMatch(/^otpauth:\/\/totp\//)
      expect(uri).toContain('secret=JBSWY3DPEHPK3PXP')
      expect(uri).toContain('issuer=Arche')
    })
  })

  describe('verifyTotp', () => {
    it('returns valid: true for valid code', () => {
      const secret = 'JBSWY3DPEHPK3PXP'
      const code = totp.generateCurrentCode(secret)
      const result = totp.verifyTotp(secret, code)
      expect(result.valid).toBe(true)
      expect(result.windowStart).toBeInstanceOf(Date)
    })

    it('returns valid: false for invalid code', () => {
      expect(totp.verifyTotp('JBSWY3DPEHPK3PXP', '000000').valid).toBe(false)
    })

    it('returns valid: false for malformed codes', () => {
      expect(totp.verifyTotp('JBSWY3DPEHPK3PXP', '').valid).toBe(false)
      expect(totp.verifyTotp('JBSWY3DPEHPK3PXP', '12345').valid).toBe(false)
      expect(totp.verifyTotp('JBSWY3DPEHPK3PXP', 'abcdef').valid).toBe(false)
    })

    it('rejects replayed code (same window)', () => {
      const secret = 'JBSWY3DPEHPK3PXP'
      const code = totp.generateCurrentCode(secret)
      const result1 = totp.verifyTotp(secret, code)
      expect(result1.valid).toBe(true)

      // Try to replay the same code
      const result2 = totp.verifyTotp(secret, code, result1.windowStart)
      expect(result2.valid).toBe(false)
    })

    it('accepts code when lastUsedAt is from earlier window', () => {
      const secret = 'JBSWY3DPEHPK3PXP'
      const code = totp.generateCurrentCode(secret)
      // Set lastUsedAt to 2 minutes ago (4 windows back)
      const oldTimestamp = new Date(Date.now() - 2 * 60 * 1000)
      const result = totp.verifyTotp(secret, code, oldTimestamp)
      expect(result.valid).toBe(true)
    })
  })

  describe('generateRecoveryCodes', () => {
    it('returns 10 codes by default', () => {
      expect(totp.generateRecoveryCodes()).toHaveLength(10)
    })

    it('returns codes in XXXX-XXXX format', () => {
      for (const code of totp.generateRecoveryCodes()) {
        expect(code).toMatch(/^[A-Z0-9]{4}-[A-Z0-9]{4}$/)
      }
    })

    it('generates unique codes', () => {
      const codes = totp.generateRecoveryCodes()
      expect(new Set(codes).size).toBe(codes.length)
    })
  })
})

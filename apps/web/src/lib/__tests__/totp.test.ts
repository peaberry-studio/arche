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
    it('returns true for valid code', () => {
      const secret = 'JBSWY3DPEHPK3PXP'
      const code = totp.generateCurrentCode(secret)
      expect(totp.verifyTotp(secret, code)).toBe(true)
    })

    it('returns false for invalid code', () => {
      expect(totp.verifyTotp('JBSWY3DPEHPK3PXP', '000000')).toBe(false)
    })

    it('returns false for malformed codes', () => {
      expect(totp.verifyTotp('JBSWY3DPEHPK3PXP', '')).toBe(false)
      expect(totp.verifyTotp('JBSWY3DPEHPK3PXP', '12345')).toBe(false)
      expect(totp.verifyTotp('JBSWY3DPEHPK3PXP', 'abcdef')).toBe(false)
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

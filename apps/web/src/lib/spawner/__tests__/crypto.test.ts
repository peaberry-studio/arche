import { createCipheriv, randomBytes } from 'node:crypto'

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'

function encryptLikeBootstrapWeb(plaintext: string, key: Buffer): string {
  const iv = randomBytes(16)
  const cipher = createCipheriv('aes-256-gcm', key, iv)
  const encrypted = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()])
  const authTag = cipher.getAuthTag()

  return `${iv.toString('base64')}:${authTag.toString('base64')}:${encrypted.toString('base64')}`
}

describe('crypto', () => {
  const originalEnv = process.env

  beforeEach(() => {
    vi.resetModules()
    process.env = { ...originalEnv }
  })

  afterEach(() => {
    process.env = originalEnv
  })

  describe('generatePassword', () => {
    it('generates a base64url encoded 32-byte password', async () => {
      const { generatePassword } = await import('../crypto')
      const password = generatePassword()

      // base64url of 32 bytes = 43 characters (no padding)
      expect(password).toMatch(/^[A-Za-z0-9_-]{43}$/)
    })

    it('generates unique passwords each time', async () => {
      const { generatePassword } = await import('../crypto')
      const passwords = new Set(Array.from({ length: 100 }, () => generatePassword()))

      expect(passwords.size).toBe(100)
    })
  })

  describe('encryptPassword / decryptPassword', () => {
    it('encrypts and decrypts a password correctly', async () => {
      process.env.ARCHE_ENCRYPTION_KEY = Buffer.from('test-key-32-bytes-long-for-aes!!').toString('base64')

      const { encryptPassword, decryptPassword } = await import('../crypto')
      const original = 'my-secret-password-123'

      const encrypted = encryptPassword(original)
      const decrypted = decryptPassword(encrypted)

      expect(decrypted).toBe(original)
    })

    it('produces different ciphertext for same plaintext (random IV)', async () => {
      process.env.ARCHE_ENCRYPTION_KEY = Buffer.from('test-key-32-bytes-long-for-aes!!').toString('base64')

      const { encryptPassword } = await import('../crypto')
      const password = 'same-password'

      const encrypted1 = encryptPassword(password)
      const encrypted2 = encryptPassword(password)

      expect(encrypted1).not.toBe(encrypted2)
    })

    it('encrypted format is iv:authTag:ciphertext in base64', async () => {
      process.env.ARCHE_ENCRYPTION_KEY = Buffer.from('test-key-32-bytes-long-for-aes!!').toString('base64')

      const { encryptPassword } = await import('../crypto')
      const encrypted = encryptPassword('test')

      const parts = encrypted.split(':')
      expect(parts).toHaveLength(3)

      // Each part should be valid base64
      parts.forEach((part) => {
        expect(() => Buffer.from(part, 'base64')).not.toThrow()
      })
    })

    it('throws on tampered ciphertext', async () => {
      process.env.ARCHE_ENCRYPTION_KEY = Buffer.from('test-key-32-bytes-long-for-aes!!').toString('base64')

      const { encryptPassword, decryptPassword } = await import('../crypto')
      const encrypted = encryptPassword('secret')

      // Tamper with the ciphertext
      const parts = encrypted.split(':')
      parts[2] = Buffer.from('tampered').toString('base64')
      const tampered = parts.join(':')

      expect(() => decryptPassword(tampered)).toThrow()
    })

    it('throws on wrong key', async () => {
      process.env.ARCHE_ENCRYPTION_KEY = Buffer.from('test-key-32-bytes-long-for-aes!!').toString('base64')
      const { encryptPassword } = await import('../crypto')
      const encrypted = encryptPassword('secret')

      // Change key
      vi.resetModules()
      process.env.ARCHE_ENCRYPTION_KEY = Buffer.from('different-key-32-bytes-long!!!!!').toString('base64')
      const { decryptPassword } = await import('../crypto')

      expect(() => decryptPassword(encrypted)).toThrow()
    })

    it('uses dev key in non-production when ARCHE_ENCRYPTION_KEY not set', async () => {
      delete process.env.ARCHE_ENCRYPTION_KEY
      process.env.NODE_ENV = 'development'

      const { encryptPassword, decryptPassword } = await import('../crypto')
      const original = 'dev-password'

      const encrypted = encryptPassword(original)
      const decrypted = decryptPassword(encrypted)

      expect(decrypted).toBe(original)
    })

    it('decrypts passwords encrypted by the web E2E bootstrap format', async () => {
      const key = Buffer.from('test-key-32-bytes-long-for-aes!!')
      process.env.ARCHE_ENCRYPTION_KEY = key.toString('base64')

      const { decryptPassword } = await import('../crypto')
      const encrypted = encryptLikeBootstrapWeb('bootstrap-runtime-password', key)

      expect(decryptPassword(encrypted)).toBe('bootstrap-runtime-password')
    })
  })
})

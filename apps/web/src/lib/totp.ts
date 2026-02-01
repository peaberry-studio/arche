import crypto from 'node:crypto'
import { TOTP } from 'otpauth'
import { getEncryptionKey } from './spawner/config'

const ALGORITHM = 'aes-256-gcm'
const TOTP_DIGITS = 6
const TOTP_PERIOD = 30
const TOTP_WINDOW = 1

export function generateSecret(): string {
  const bytes = crypto.randomBytes(20)
  return base32Encode(bytes)
}

export function encryptSecret(plaintext: string): string {
  const key = getEncryptionKey()
  const iv = crypto.randomBytes(16)
  const cipher = crypto.createCipheriv(ALGORITHM, key, iv)
  const encrypted = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()])
  const authTag = cipher.getAuthTag()
  return `${iv.toString('base64')}:${authTag.toString('base64')}:${encrypted.toString('base64')}`
}

export function decryptSecret(encoded: string): string {
  const key = getEncryptionKey()
  const [ivB64, authTagB64, encryptedB64] = encoded.split(':')
  if (!ivB64 || !authTagB64 || !encryptedB64) {
    throw new Error('Malformed encrypted secret')
  }
  const iv = Buffer.from(ivB64, 'base64')
  const authTag = Buffer.from(authTagB64, 'base64')
  const encrypted = Buffer.from(encryptedB64, 'base64')
  const decipher = crypto.createDecipheriv(ALGORITHM, key, iv)
  decipher.setAuthTag(authTag)
  return decipher.update(encrypted).toString('utf8') + decipher.final('utf8')
}

export function generateTotpUri(params: { secret: string; email: string; issuer: string }): string {
  const totp = new TOTP({
    issuer: params.issuer,
    label: params.email,
    algorithm: 'SHA1',
    digits: TOTP_DIGITS,
    period: TOTP_PERIOD,
    secret: params.secret,
  })
  return totp.toString()
}

/**
 * Verify a TOTP code with optional replay protection.
 * @param secret - The TOTP secret (base32)
 * @param code - The 6-digit code to verify
 * @param lastUsedAt - Optional timestamp of last successful verification (for replay protection)
 * @returns Object with valid flag and current window timestamp if valid
 */
export function verifyTotp(
  secret: string,
  code: string,
  lastUsedAt?: Date | null
): { valid: boolean; windowStart?: Date } {
  if (!code || !/^\d{6}$/.test(code)) return { valid: false }

  const totp = new TOTP({ algorithm: 'SHA1', digits: TOTP_DIGITS, period: TOTP_PERIOD, secret })
  const delta = totp.validate({ token: code, window: TOTP_WINDOW })

  if (delta === null) return { valid: false }

  // Calculate the window start time for this code
  const now = Math.floor(Date.now() / 1000)
  const windowStart = new Date((now - (now % TOTP_PERIOD) + delta * TOTP_PERIOD) * 1000)

  // Replay protection: reject if code from same or earlier window was already used
  if (lastUsedAt && windowStart <= lastUsedAt) {
    return { valid: false }
  }

  return { valid: true, windowStart }
}

export function generateCurrentCode(secret: string): string {
  const totp = new TOTP({ algorithm: 'SHA1', digits: TOTP_DIGITS, period: TOTP_PERIOD, secret })
  return totp.generate()
}

export function generateRecoveryCodes(count = 10): string[] {
  const codes: string[] = []
  while (codes.length < count) {
    const hex = crypto.randomBytes(4).toString('hex').toUpperCase()
    const code = `${hex.slice(0, 4)}-${hex.slice(4, 8)}`
    if (!codes.includes(code)) codes.push(code)
  }
  return codes
}

const BASE32_ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567'

function base32Encode(buffer: Buffer): string {
  let bits = 0, value = 0, output = ''
  for (const byte of buffer) {
    value = (value << 8) | byte
    bits += 8
    while (bits >= 5) {
      output += BASE32_ALPHABET[(value >>> (bits - 5)) & 31]
      bits -= 5
    }
  }
  if (bits > 0) output += BASE32_ALPHABET[(value << (5 - bits)) & 31]
  return output
}

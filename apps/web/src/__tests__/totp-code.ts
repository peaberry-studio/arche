import { TOTP } from 'otpauth'

/**
 * Test-only helper that fabricates a currently valid TOTP code,
 * matching the app's parameters (SHA1, 6 digits, 30s period).
 */
export function generateCurrentTotpCode(secret: string): string {
  return new TOTP({ algorithm: 'SHA1', digits: 6, period: 30, secret }).generate()
}

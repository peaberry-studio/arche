import { randomBytes, timingSafeEqual } from 'crypto'

export const DESKTOP_TOKEN_HEADER = 'x-arche-desktop-token'
const TOKEN_BYTES = 32

export function generateDesktopToken(): string {
  return randomBytes(TOKEN_BYTES).toString('base64url')
}

export function getDesktopToken(): string | null {
  return process.env.ARCHE_DESKTOP_API_TOKEN || null
}

export function validateDesktopToken(candidate: string | null): boolean {
  const expected = getDesktopToken()
  if (!expected || !candidate) {
    return false
  }

  const a = Buffer.from(candidate)
  const b = Buffer.from(expected)
  if (a.length !== b.length) {
    return false
  }

  return timingSafeEqual(a, b)
}

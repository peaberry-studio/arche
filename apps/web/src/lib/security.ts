import crypto from 'node:crypto'

export function getSessionPepper(): string {
  const pepper = process.env.ARCHE_SESSION_PEPPER
  if (pepper) return pepper
  if (process.env.NODE_ENV === 'production') {
    throw new Error('ARCHE_SESSION_PEPPER is required in production')
  }
  console.warn('[security] Using insecure development secret for session pepper. Set ARCHE_SESSION_PEPPER env var.')
  return 'dev-insecure-pepper'
}

export function hashSessionToken(token: string): string {
  const pepper = getSessionPepper()
  return crypto.createHash('sha256').update(`${token}.${pepper}`).digest('hex')
}

export function newSessionToken(): string {
  return crypto.randomBytes(32).toString('base64url')
}

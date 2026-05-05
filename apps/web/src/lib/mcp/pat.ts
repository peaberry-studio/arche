import crypto from 'node:crypto'

import { getSessionPepper } from '@/lib/security'

export const PAT_PREFIX = 'arche_pat_'

export function generatePat(): string {
  const body = crypto.randomBytes(32).toString('hex')
  return `${PAT_PREFIX}${body}`
}

export function hasPatPrefix(token: string): boolean {
  return token.startsWith(PAT_PREFIX)
}

export function generatePatSalt(): string {
  return crypto.randomBytes(16).toString('hex')
}

export function hashPatLookup(token: string): string {
  return hashValue(`${token}.${getSessionPepper()}`)
}

export function hashPat(token: string, salt: string): string {
  return hashValue(`${token}.${salt}.${getSessionPepper()}`)
}

export function verifyPat(token: string, salt: string, storedHash: string): boolean {
  const candidateHash = hashPat(token, salt)
  const candidateBuffer = Buffer.from(candidateHash, 'hex')
  const storedBuffer = Buffer.from(storedHash, 'hex')

  if (candidateBuffer.length !== storedBuffer.length) {
    return false
  }

  return crypto.timingSafeEqual(candidateBuffer, storedBuffer)
}

function hashValue(value: string): string {
  return crypto.createHash('sha256').update(value).digest('hex')
}

import { encryptPassword, decryptPassword } from '@/lib/spawner/crypto'
import type { ProviderSecret } from './types'

const MAX_SECRET_SIZE = 16 * 1024

export function encryptProviderSecret(secret: ProviderSecret): string {
  const json = JSON.stringify(secret)
  if (json.length > MAX_SECRET_SIZE) {
    throw new Error('Provider secret exceeds maximum size')
  }
  return encryptPassword(json)
}

export function decryptProviderSecret(encrypted: string): ProviderSecret {
  try {
    return JSON.parse(decryptPassword(encrypted)) as ProviderSecret
  } catch {
    throw new Error('Failed to decrypt provider secret')
  }
}

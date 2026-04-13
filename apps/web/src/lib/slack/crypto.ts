import { decryptPassword, encryptPassword } from '@/lib/spawner/crypto'

export function encryptSlackToken(token: string): string {
  return encryptPassword(token)
}

export function decryptSlackToken(secret: string): string {
  return decryptPassword(secret)
}

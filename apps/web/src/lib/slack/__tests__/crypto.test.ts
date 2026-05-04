import { describe, it, expect, vi } from 'vitest'
import { encryptSlackToken, decryptSlackToken } from '../crypto'

vi.mock('@/lib/spawner/crypto', () => ({
  encryptPassword: (token: string) => `encrypted:${token}`,
  decryptPassword: (secret: string) => secret.replace('encrypted:', ''),
}))

describe('slack crypto', () => {
  it('encrypts a slack token using spawner crypto', () => {
    expect(encryptSlackToken('xoxb-token')).toBe('encrypted:xoxb-token')
  })

  it('decrypts a slack token using spawner crypto', () => {
    expect(decryptSlackToken('encrypted:xoxb-token')).toBe('xoxb-token')
  })
})
